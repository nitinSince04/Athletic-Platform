import { useRef, useState } from "react";
import { CheckCircle2, FileVideo, Loader2, UploadCloud, AlertCircle, LogIn } from "lucide-react";
import Card from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { uploadVideoToCloudinary, triggerCricketMLAnalysis } from "../../api/analysisApi.js";
import "./VideoUploadPanel.css";

const STAGES = {
  IDLE: "idle",
  UPLOADING_CLOUDINARY: "uploading_cloudinary",
  EXTRACTING_POSE: "extracting_pose",
  COMPUTING_FEATURES: "computing_features",
  RUNNING_CLASSIFICATION: "running_classification",
  GENERATING_REPORT: "generating_report",
  COMPLETE: "complete",
  ERROR: "error",
};

export default function VideoUploadPanel({ onAnalysisComplete, onOpenAuthModal }) {
  const { isAuthenticated, token } = useAuth();
  const [stage, setStage] = useState(STAGES.IDLE);
  const [fileName, setFileName] = useState(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isAuthError, setIsAuthError] = useState(false);
  const inputRef = useRef(null);

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Prevent duplicate upload if already running
    if (stage !== STAGES.IDLE && stage !== STAGES.COMPLETE && stage !== STAGES.ERROR) {
      return;
    }

    // Check if user is authenticated first
    const activeToken = token || localStorage.getItem('authToken');
    if (!isAuthenticated && !activeToken) {
      setStage(STAGES.ERROR);
      setIsAuthError(true);
      setErrorMessage("Authentication required. Please sign in to your athlete account to analyze videos.");
      return;
    }

    // Validate video file format & size
    if (!file.type.startsWith("video/")) {
      setStage(STAGES.ERROR);
      setIsAuthError(false);
      setErrorMessage("Invalid file format. Please upload a valid cricket video (MP4, MOV, AVI).");
      return;
    }

    if (file.size > 150 * 1024 * 1024) {
      setStage(STAGES.ERROR);
      setIsAuthError(false);
      setErrorMessage("File size exceeds 150MB limit. Please upload a shorter clip.");
      return;
    }

    setFileName(file.name);
    startUploadPipeline(file);
  }

  async function startUploadPipeline(file) {
    setStage(STAGES.UPLOADING_CLOUDINARY);
    setProgress(15);
    setStatusMessage("Uploading video to Cloudinary...");
    setErrorMessage("");
    setIsAuthError(false);

    try {
      // Step 1: Upload to Cloudinary via backend
      const uploadRes = await uploadVideoToCloudinary(file);
      const videoUrl = uploadRes.secure_url;
      const publicId = uploadRes.public_id;

      setProgress(40);
      setStage(STAGES.EXTRACTING_POSE);
      setStatusMessage("✓ Video uploaded to Cloudinary. Extracting MediaPipe pose keypoints...");

      await new Promise((r) => setTimeout(r, 600));

      // Step 2: Compute 528 features
      setProgress(60);
      setStage(STAGES.COMPUTING_FEATURES);
      setStatusMessage("✓ Keypoints extracted. Generating 528 velocity, acceleration & spatial features...");

      await new Promise((r) => setTimeout(r, 600));

      // Step 3: Run PyTorch model & analysis
      setProgress(80);
      setStage(STAGES.RUNNING_CLASSIFICATION);
      setStatusMessage("✓ 30-frame sequence ready. Running CNN + BiLSTM stroke classification...");

      const analysisResult = await triggerCricketMLAnalysis(videoUrl, publicId);

      // Validate result before showing completion: Never mark complete if stroke is unknown or scores are missing
      const strokeName = analysisResult?.prediction?.stroke || analysisResult?.prediction?.predicted_stroke || analysisResult?.stroke;
      if (!strokeName || strokeName === 'Unknown' || strokeName === 'Processing...') {
        throw new Error("Analysis failed: Cricket stroke classification could not be determined. Please upload a clear cricket video clip.");
      }
      if (!analysisResult?.scores || typeof analysisResult?.scores?.overall !== 'number') {
        throw new Error("Analysis failed: Technical performance scoring could not be computed.");
      }

      // Step 4: Generating Report & PDF
      setProgress(95);
      setStage(STAGES.GENERATING_REPORT);
      setStatusMessage("✓ Stroke classification complete. Generating technical report & PDF...");

      await new Promise((r) => setTimeout(r, 500));

      setProgress(100);
      setStage(STAGES.COMPLETE);
      setStatusMessage("Analysis complete!");

      if (onAnalysisComplete) {
        onAnalysisComplete(analysisResult);
      }
    } catch (err) {
      console.error("Pipeline failure:", err);
      setStage(STAGES.ERROR);
      const msg = err.message || "Failed to process video.";
      if (msg.includes("Authentication required") || msg.includes("401")) {
        setIsAuthError(true);
        setErrorMessage("Authentication required. Please sign in to your athlete account to analyze cricket stroke videos.");
      } else if (err.status === 429 || msg.includes("capacity") || msg.includes("in progress")) {
        setIsAuthError(false);
        setErrorMessage(msg || "The AI analysis engine is currently processing at capacity. Please wait a moment and try again.");
      } else if (err.status === 502 || err.status === 503 || msg.includes("starting up") || msg.includes("unreachable")) {
        setIsAuthError(false);
        setErrorMessage("The AI analysis engine is starting up on the server. Please wait about 30 seconds and try again.");
      } else {
        setIsAuthError(false);
        setErrorMessage(msg);
      }
    }
  }

  function reset() {
    setStage(STAGES.IDLE);
    setFileName(null);
    setProgress(0);
    setStatusMessage("");
    setErrorMessage("");
    setIsAuthError(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <Card eyebrow="Analysis input" title="Upload Cricket Drill or Match Video">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        onChange={handleFileSelected}
        style={{ display: "none" }}
      />

      {stage === STAGES.IDLE && (
        <button
          type="button"
          className="upload-dropzone"
          onClick={() => {
            const activeToken = token || localStorage.getItem('authToken');
            if (!isAuthenticated && !activeToken && onOpenAuthModal) {
              onOpenAuthModal();
            } else {
              inputRef.current?.click();
            }
          }}
        >

          <UploadCloud size={28} strokeWidth={1.75} color="var(--accent-teal)" />
          <p className="upload-dropzone__title">Drop a cricket stroke video clip</p>
          <p className="upload-dropzone__hint">
            {isAuthenticated
              ? "Supports MP4, MOV or AVI (Block, Cut, Glance, Hook, OffDrive, OnDrive)"
              : "Sign in required to upload and analyze cricket stroke videos"}
          </p>
        </button>
      )}

      {stage !== STAGES.IDLE && stage !== STAGES.COMPLETE && stage !== STAGES.ERROR && (
        <div className="upload-progress stack">
          <div className="upload-progress__row">
            <FileVideo size={18} color="var(--accent-teal)" />
            <span className="upload-progress__name">{fileName}</span>
            <span className="mono-stat upload-progress__pct">{progress}%</span>
          </div>
          <div className="upload-progress__bar">
            <div className="upload-progress__bar-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="upload-status-row">
            <Loader2 size={16} className="spin" color="var(--accent-teal)" />
            <p className="upload-dropzone__hint">{statusMessage}</p>
          </div>
        </div>
      )}

      {stage === STAGES.COMPLETE && (
        <div className="upload-status stack">
          <div className="status-complete-row">
            <CheckCircle2 size={22} color="var(--accent-teal)" />
            <div>
              <p className="upload-status__title">{fileName}</p>
              <p className="upload-dropzone__hint">Analysis ready — Full technical breakdown displayed</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>
            Upload Another Video
          </Button>
        </div>
      )}

      {stage === STAGES.ERROR && (
        <div className="upload-status stack">
          <div className="status-complete-row">
            <AlertCircle size={22} color="var(--accent-coral, #e63946)" />
            <div>
              <p className="upload-status__title" style={{ color: "var(--accent-coral, #e63946)" }}>
                {isAuthError ? "Authentication Required" : "Analysis Failed"}
              </p>
              <p className="upload-dropzone__hint">{errorMessage}</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            {isAuthError && onOpenAuthModal && (
              <Button variant="primary" size="sm" onClick={onOpenAuthModal}>
                <LogIn size={16} style={{ marginRight: "0.4rem" }} />
                Sign In / Register
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={reset}>
              Try Again
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
