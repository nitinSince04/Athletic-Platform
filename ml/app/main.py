import os
import sys
import gc
import time
import tempfile
import uuid
import asyncio
import threading
import cv2
import requests
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field, HttpUrl

# Ensure writable matplotlib config directory for Linux / Render / Serverless
if "MPLCONFIGDIR" not in os.environ:
    os.environ["MPLCONFIGDIR"] = os.path.join(tempfile.gettempdir(), "matplotlib")

# Ensure parent directory is in sys.path so 'ml' package can be imported properly
BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from ml.api.analyze import analyze_video
from ml.inference.predictor import CricketStrokePredictor, get_predictor
from ml.features.normalization import FeatureNormalizer, get_normalizer
from ml.reports.pdf_generator import generate_pdf_report

# ---------------------------------------------------------------------------
# Global predictor instance loaded ONCE at startup
# ---------------------------------------------------------------------------
predictor_instance = None

# ---------------------------------------------------------------------------
# Concurrency management: 512MB RAM free instance safely processes 1 video at a time
# ---------------------------------------------------------------------------
MAX_CONCURRENT_ANALYSES = int(os.getenv("MAX_CONCURRENT_ANALYSES", "1"))
analysis_semaphore = asyncio.Semaphore(MAX_CONCURRENT_ANALYSES)
MAX_VIDEO_SIZE_MB = int(os.getenv("MAX_VIDEO_SIZE_MB", "150"))
VIDEO_DOWNLOAD_TIMEOUT = int(os.getenv("VIDEO_DOWNLOAD_TIMEOUT", "120"))

REPORTS_DIR = BASE_DIR / "ml" / "reports" / "generated"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# In-memory job store – honest about non-persistence across restarts
# ---------------------------------------------------------------------------
# Each job: { status, result, error, created_at, updated_at, video_url, user_id }
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()

JOB_TTL_SECONDS = int(os.getenv("JOB_TTL_SECONDS", "3600"))   # 1 hour default
JOB_MAX_STORE = int(os.getenv("JOB_MAX_STORE", "200"))


def _ts():
    """Returns ISO-8601 timestamp string for logging."""
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def _set_job(job_id: str, **fields):
    """Thread-safe job field update."""
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(fields, updated_at=time.time())


def _get_job(job_id: str) -> dict | None:
    with _jobs_lock:
        return _jobs.get(job_id)


def _create_job(video_url: str, user_id: str | None) -> str:
    """Creates a new job entry. Returns job_id."""
    job_id = uuid.uuid4().hex[:16]
    now = time.time()
    with _jobs_lock:
        # Evict expired jobs
        expired = [k for k, v in _jobs.items()
                   if now - v.get("created_at", 0) > JOB_TTL_SECONDS]
        for k in expired:
            del _jobs[k]
        # Cap store size
        if len(_jobs) >= JOB_MAX_STORE:
            oldest_key = min(_jobs, key=lambda k: _jobs[k].get("created_at", 0))
            del _jobs[oldest_key]
        _jobs[job_id] = {
            "status": "processing",
            "result": None,
            "error": None,
            "video_url": video_url,
            "user_id": user_id,
            "created_at": now,
            "updated_at": now,
        }
    return job_id


def _find_active_job_for_url(video_url: str) -> str | None:
    """Returns job_id of an already-processing job for this video_url, or None."""
    with _jobs_lock:
        for jid, j in _jobs.items():
            if j["video_url"] == video_url and j["status"] == "processing":
                return jid
    return None


def cleanup_old_reports(max_age_hours=24):
    """Purges generated PDF/chart reports older than max_age_hours to prevent disk accumulation."""
    try:
        now = time.time()
        max_age_secs = max_age_hours * 3600
        for f in REPORTS_DIR.iterdir():
            if f.is_file() and (now - f.stat().st_mtime) > max_age_secs:
                try:
                    f.unlink()
                except Exception:
                    pass
    except Exception:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager loading the ML model and normalizer ONCE at server startup."""
    global predictor_instance
    print(f"[{_ts()}] [ML Service] Pre-loading PyTorch BiLSTM model into memory...")
    try:
        app.state.predictor = get_predictor()
        app.state.normalizer = get_normalizer()
        predictor_instance = app.state.predictor
        print(f"[{_ts()}] [ML Service] Model '{predictor_instance.model_name}' successfully loaded into memory.")
    except Exception as e:
        print(f"[{_ts()}] [ML Service] Warning: Failed to pre-load model at startup: {e}")

    cleanup_old_reports(max_age_hours=24)
    yield
    print(f"[{_ts()}] [ML Service] Shutting down ML service...")

app = FastAPI(
    title="Cricket Sports AI ML Inference Engine",
    description="FastAPI Service providing 528-feature pose extraction, BiLSTM stroke classification, biomechanical technique scoring, feedback, and PDF report generation.",
    version="2.1.0",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalysisRequest(BaseModel):
    video_url: str = Field(..., description="Cloudinary video URL or accessible video URL/path")
    user_id: str | None = Field(default=None, description="Optional user ID associated with request")
    sync: bool | None = Field(default=False, description="Optional flag to run synchronously and wait for complete result")


def download_video_file(video_url: str) -> tuple[str, str | None]:
    """
    Securely downloads video from Cloudinary / HTTP URL to a temporary local file
    with size limits & OpenCV validation.

    Returns:
        (local_path, sha256_hex)  – SHA256 computed during download to avoid a second full-file read.
    """
    import hashlib

    if os.path.exists(video_url):
        return video_url, None

    if not (video_url.startswith("http://") or video_url.startswith("https://")):
        raise HTTPException(status_code=400, detail="Invalid video URL format. Must be an HTTP(S) URL or valid local file path.")

    temp_path = None
    try:
        t0 = time.time()
        print(f"[{_ts()}] [Download] Starting video download: {video_url[:120]}...")
        response = requests.get(video_url, stream=True, timeout=VIDEO_DOWNLOAD_TIMEOUT)
        response.raise_for_status()

        # Check content-length header if provided
        content_length = response.headers.get("content-length")
        max_bytes = MAX_VIDEO_SIZE_MB * 1024 * 1024
        if content_length and int(content_length) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Video file exceeds maximum size of {MAX_VIDEO_SIZE_MB}MB (received {int(content_length)/(1024*1024):.1f}MB)."
            )

        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        temp_path = temp_file.name
        downloaded_bytes = 0
        sha256 = hashlib.sha256()

        for chunk in response.iter_content(chunk_size=65536):
            if chunk:
                downloaded_bytes += len(chunk)
                if downloaded_bytes > max_bytes:
                    temp_file.close()
                    cleanup_file(temp_path)
                    raise HTTPException(
                        status_code=413,
                        detail=f"Video download exceeded maximum allowed size of {MAX_VIDEO_SIZE_MB}MB."
                    )
                temp_file.write(chunk)
                sha256.update(chunk)
        temp_file.close()

        sha256_hex = sha256.hexdigest()
        elapsed = time.time() - t0
        print(f"[{_ts()}] [Download] Completed in {elapsed:.1f}s — {downloaded_bytes/(1024*1024):.1f}MB, SHA256={sha256_hex[:16]}...")

        # Validate that the downloaded file is non-empty and readable by OpenCV
        if not os.path.exists(temp_path) or os.path.getsize(temp_path) == 0:
            cleanup_file(temp_path)
            raise HTTPException(status_code=400, detail="Downloaded video file is empty.")

        test_cap = cv2.VideoCapture(temp_path)
        is_valid = test_cap.isOpened()
        frame_count = int(test_cap.get(cv2.CAP_PROP_FRAME_COUNT)) if is_valid else 0
        test_cap.release()

        if not is_valid or frame_count <= 0:
            cleanup_file(temp_path)
            raise HTTPException(
                status_code=400,
                detail="Downloaded video file is corrupted or could not be decoded as a valid video stream."
            )

        print(f"[{_ts()}] [Download] OpenCV validation passed — {frame_count} frames detected.")
        return temp_path, sha256_hex

    except HTTPException:
        if temp_path:
            cleanup_file(temp_path)
        raise
    except requests.RequestException as e:
        if temp_path:
            cleanup_file(temp_path)
        raise HTTPException(status_code=502, detail=f"Failed to download video from Cloudinary: {str(e)}")
    except Exception as e:
        if temp_path:
            cleanup_file(temp_path)
        raise HTTPException(status_code=500, detail=f"Unexpected error during video retrieval: {str(e)}")


def cleanup_file(file_path: str):
    """Helper to remove temporary files after request completion."""
    try:
        if file_path and os.path.exists(file_path) and "tmp" in file_path.lower():
            os.remove(file_path)
            print(f"[{_ts()}] [Cleanup] Removed temp file: {file_path}")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Background job runner – executes the full ML pipeline in a thread
# ---------------------------------------------------------------------------
def _run_analysis_job(job_id: str, video_url: str, user_id: str | None):
    """
    Synchronous worker that runs the full ML pipeline.
    Called from a background thread so the HTTP response returns immediately.
    Stores the result (or error) in the in-memory job store.
    """
    video_path = video_url
    is_temp = False
    sha256_hex = None

    try:
        t_total = time.time()
        print(f"[{_ts()}] [Job {job_id}] ===== STARTING ML PIPELINE =====")

        # --- Step 1: Download video ---
        if video_path.startswith("http://") or video_path.startswith("https://"):
            video_path, sha256_hex = download_video_file(video_path)
            is_temp = True

        # --- Step 2: Retrieve shared predictor & normalizer ---
        shared_predictor = predictor_instance or get_predictor()
        shared_normalizer = get_normalizer()

        # --- Step 3: Run ML analysis pipeline ---
        t_analyze = time.time()
        results = analyze_video(
            video_path,
            predictor=shared_predictor,
            normalizer=shared_normalizer,
            precomputed_sha256=sha256_hex,
        )
        print(f"[{_ts()}] [Job {job_id}] ML pipeline completed in {time.time() - t_analyze:.1f}s")

        # --- Step 4: Generate PDF report ---
        t_pdf = time.time()
        report_id = f"report_{uuid.uuid4().hex[:8]}.pdf"
        pdf_path = REPORTS_DIR / report_id
        generate_pdf_report(results, str(pdf_path))
        print(f"[{_ts()}] [Job {job_id}] PDF generated in {time.time() - t_pdf:.1f}s")

        results["success"] = True
        results["pdf_filename"] = report_id
        results["pdf_download_url"] = f"/api/ml/pdf/{report_id}"

        # Strict validation: prevent marking incomplete or unknown analysis as completed
        pred = results.get("prediction", {})
        stroke = pred.get("stroke") or pred.get("predicted_stroke")
        if not stroke or stroke == "Unknown" or float(pred.get("confidence", 0.0)) <= 0.0:
            raise ValueError(f"ML analysis failed: Invalid prediction generated ({stroke}, conf={pred.get('confidence')})")
        if not results.get("scores") or results.get("scores", {}).get("overall") is None:
            raise ValueError("ML analysis failed: Incomplete technical scores.")

        total_elapsed = time.time() - t_total
        print(f"[{_ts()}] [Job {job_id}] ===== PIPELINE COMPLETE in {total_elapsed:.1f}s =====")

        _set_job(job_id, status="completed", result=results)

    except HTTPException as he:
        print(f"[{_ts()}] [Job {job_id}] HTTP error: {he.detail}")
        _set_job(job_id, status="failed", error=he.detail)
    except Exception as exc:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[{_ts()}] [Job {job_id}] Pipeline error:\n{error_trace}")
        _set_job(job_id, status="failed", error=str(exc))
    finally:
        # Clean up temp file
        if is_temp and video_path:
            cleanup_file(video_path)
        gc.collect()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)

@app.get("/")
@app.get("/api/ml/health")
def health_check():
    return {
        "status": "healthy",
        "service": "Cricket AI ML Service",
        "model_loaded": predictor_instance is not None,
        "model_name": predictor_instance.model_name if predictor_instance else "None",
        "max_concurrent_capacity": MAX_CONCURRENT_ANALYSES,
        "active_jobs": sum(1 for j in _jobs.values() if j["status"] == "processing"),
    }


@app.post("/api/ml/analyze")
async def analyze_cricket_video(request: AnalysisRequest, sync: bool = False):
    """
    Main ML Inference Endpoint:
    - Default (async): Starts processing in background thread and returns { job_id, status: "processing" }.
    - Sync (when sync=True or ?sync=true): Waits for complete result and returns full analysis dictionary.
    - Duplicate prevention: Returns existing active job_id if already processing.
    """
    video_url = request.video_url
    user_id = request.user_id
    is_sync = bool(request.sync or sync)

    # --- Duplicate job prevention ---
    existing_jid = _find_active_job_for_url(video_url)
    if existing_jid:
        print(f"[{_ts()}] [Analyze] Duplicate request for {video_url[:80]}… — returning existing job {existing_jid}")
        if not is_sync:
            return JSONResponse(content={
                "job_id": existing_jid,
                "status": "processing",
                "message": "Analysis already in progress for this video.",
            })

    # --- Concurrency guard ---
    try:
        await asyncio.wait_for(analysis_semaphore.acquire(), timeout=1.5)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=429,
            detail="The ML analysis engine is currently processing another video at capacity. Please wait a few moments and try again."
        )

    # Create job entry
    job_id = _create_job(video_url, user_id)
    print(f"[{_ts()}] [Analyze] Created job {job_id} for {video_url[:80]}… (sync={is_sync})")

    if is_sync:
        try:
            _run_analysis_job(job_id, video_url, user_id)
            job = _get_job(job_id)
            if job and job["status"] == "completed" and job["result"]:
                return JSONResponse(content=job["result"])
            error_msg = (job and job.get("error")) or "ML analysis failed to complete."
            raise HTTPException(status_code=500, detail=error_msg)
        finally:
            analysis_semaphore.release()
            print(f"[{_ts()}] [Analyze] Semaphore released for sync job {job_id}")

    # Launch background processing in a thread (releases the semaphore when done)
    loop = asyncio.get_event_loop()

    def _worker():
        try:
            _run_analysis_job(job_id, video_url, user_id)
        finally:
            analysis_semaphore.release()
            print(f"[{_ts()}] [Analyze] Semaphore released for job {job_id}")

    loop.run_in_executor(None, _worker)

    return JSONResponse(content={
        "job_id": job_id,
        "status": "processing",
        "message": "Analysis started. Poll GET /api/ml/jobs/{job_id} for results.",
    })


@app.get("/api/ml/jobs/{job_id}")
async def get_job_status(job_id: str):
    """
    Returns current status of an analysis job.
    Possible statuses: processing, completed, failed.
    When completed, returns full prediction, scores, and metadata under both
    'result' and top-level fields for complete contract compatibility.
    """
    job = _get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found. It may have expired or the service was restarted.")

    response = {
        "job_id": job_id,
        "status": job["status"],
    }

    if job["status"] == "completed" and job["result"]:
        response["result"] = job["result"]
        response["data"] = job["result"]
        # Also include top-level fields for contract compatibility
        for k in ["prediction", "scores", "body_analysis", "feedback", "coaching_text", "video_metadata", "visualizations", "pdf_filename", "pdf_download_url", "success"]:
            if k in job["result"]:
                response[k] = job["result"][k]
    elif job["status"] == "failed":
        response["error"] = job.get("error", "Unknown error")
        response["message"] = job.get("error", "Unknown error")

    return JSONResponse(content=response)


@app.get("/api/ml/pdf/{filename}")
def download_pdf(filename: str):
    """Serves the generated PDF analysis report."""
    pdf_path = REPORTS_DIR / filename
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF report not found")

    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename=filename
    )

@app.get("/api/ml/visualizations/{filename}")
def serve_visualization(filename: str):
    """Serves generated Matplotlib & Seaborn chart PNG images."""
    chart_path = REPORTS_DIR / filename
    if not chart_path.exists():
        raise HTTPException(status_code=404, detail="Visualization chart image not found")

    return FileResponse(
        path=str(chart_path),
        media_type="image/png",
        filename=filename
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ml.app.main:app", host="0.0.0.0", port=8000, reload=True)
