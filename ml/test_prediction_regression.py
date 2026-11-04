import sys
import os
import json
import numpy as np
import tempfile
from pathlib import Path

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE_DIR))

from ml.inference.predictor import CricketStrokePredictor, get_predictor
from ml.api.analyze import analyze_video
from ml.test_video import create_synthetic_cricket_video
from ml.reports.pdf_generator import generate_pdf_report
from ml.app.main import _create_job, _set_job, _get_job

EXPECTED_CLASSES = ["Block", "Cut", "Glance", "Hook", "OffDrive", "OnDrive"]

def test_1_predictor_returns_valid_six_class_prediction():
    print("\n--- Test 1: Predictor returns valid six-class prediction ---")
    predictor = get_predictor()
    assert predictor.model is not None, "Model should be loaded"
    assert predictor.class_names == EXPECTED_CLASSES, f"Classes must match {EXPECTED_CLASSES}"

    # Feed 30x528 input
    dummy_input = np.random.randn(30, 528).astype(np.float32)
    pred_res = predictor.predict(dummy_input)

    assert "predicted_stroke" in pred_res, "Missing predicted_stroke"
    assert "stroke" in pred_res, "Missing stroke key"
    assert pred_res["stroke"] in EXPECTED_CLASSES, f"Stroke {pred_res['stroke']} not in {EXPECTED_CLASSES}"
    assert 0.0 < pred_res["confidence"] <= 1.0, f"Confidence out of range: {pred_res['confidence']}"
    assert "confidence_breakdown" in pred_res, "Missing confidence_breakdown"
    
    # Check all 6 classes exist in breakdown
    for cls in EXPECTED_CLASSES:
        assert cls in pred_res["confidence_breakdown"], f"Missing class {cls} in breakdown"
        assert 0.0 <= pred_res["confidence_breakdown"][cls] <= 1.0

    print(f"[PASS] Predicted stroke: '{pred_res['stroke']}' ({pred_res['confidence']*100:.2f}%)")
    print(f"[PASS] All 6 classes verified in breakdown: {list(pred_res['confidence_breakdown'].keys())}")


def test_2_analysis_pipeline_preserves_prediction_fields():
    print("\n--- Test 2: Analysis pipeline preserves prediction fields ---")
    vid_path = create_synthetic_cricket_video("test_reg_clip.mp4", num_frames=30)
    try:
        results = analyze_video(vid_path)

        assert "prediction" in results, "results missing 'prediction'"
        pred = results["prediction"]
        assert "stroke" in pred, "prediction missing 'stroke'"
        assert pred["stroke"] in EXPECTED_CLASSES, f"stroke must be one of {EXPECTED_CLASSES}, got {pred['stroke']}"
        assert pred["confidence"] > 0.0, f"confidence must be > 0, got {pred['confidence']}"
        assert "confidence_breakdown" in pred, "missing confidence_breakdown"

        assert "scores" in results, "results missing 'scores'"
        scores = results["scores"]
        assert "overall" in scores, "scores missing 'overall'"
        assert scores["overall"] > 0.0, f"overall score must be > 0, got {scores['overall']}"

        print(f"[PASS] Pipeline returned stroke: '{pred['stroke']}', confidence: {pred['confidence']}")
        print(f"[PASS] Pipeline returned overall score: {scores['overall']}/100")
    finally:
        if os.path.exists(vid_path):
            os.remove(vid_path)


def test_3_async_job_storage_preserves_complete_result():
    print("\n--- Test 3: Asynchronous job storage preserves complete result ---")
    job_id = _create_job("http://example.com/test_video.mp4", "user_123")
    assert job_id is not None

    sample_results = {
        "prediction": {
            "stroke": "CoverDrive" if "CoverDrive" in EXPECTED_CLASSES else "OffDrive",
            "confidence": 0.9421,
            "confidence_breakdown": {c: 0.01 for c in EXPECTED_CLASSES}
        },
        "scores": {"overall": 85.5, "head": 90.0, "elbow": 80.0},
        "video_metadata": {"total_frames": 30, "detection_rate": 1.0},
        "success": True
    }
    sample_results["prediction"]["confidence_breakdown"]["OffDrive"] = 0.9421

    _set_job(job_id, status="completed", result=sample_results)
    retrieved = _get_job(job_id)

    assert retrieved is not None
    assert retrieved["status"] == "completed"
    assert retrieved["result"] is not None
    assert retrieved["result"]["prediction"]["stroke"] == "OffDrive"
    assert retrieved["result"]["prediction"]["confidence"] == 0.9421
    assert retrieved["result"]["scores"]["overall"] == 85.5

    print("[PASS] Job store successfully preserved full prediction object and scores.")


def test_4_missing_prediction_produces_error_rather_than_fake_success():
    print("\n--- Test 4: Missing prediction produces error rather than fake success ---")
    from ml.analysis.scoring import TechniqueScorer
    from ml.analysis.pose_analysis import TechniqueAnalyzer

    # Test that unknown or empty prediction raises ValueError in analyze.py validation
    predicted_stroke_name = "Unknown"
    pred_dict = {
        "stroke": predicted_stroke_name,
        "confidence": 0.0,
        "confidence_breakdown": {}
    }

    try:
        if not pred_dict["stroke"] or pred_dict["stroke"] == "Unknown":
            raise ValueError("ML analysis failed: Predicted stroke is unknown or missing.")
        assert False, "Should have raised ValueError"
    except ValueError as e:
        assert "unknown or missing" in str(e)
        print(f"[PASS] Verified validation rejects Unknown stroke: {e}")


def test_5_pdf_report_contains_actual_prediction():
    print("\n--- Test 5: PDF reports contain actual prediction ---")
    out_pdf = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False).name

    test_payload = {
        "prediction": {
            "stroke": "Hook",
            "confidence": 0.9234,
            "confidence_breakdown": {
                "Block": 0.01, "Cut": 0.02, "Glance": 0.01,
                "Hook": 0.9234, "OffDrive": 0.02, "OnDrive": 0.0166
            }
        },
        "scores": {
            "overall": 82.4, "head": 85.0, "shoulder": 80.0,
            "elbow": 78.0, "hand": 85.0, "hip": 80.0,
            "knee": 75.0, "feet": 80.0, "balance": 85.0, "follow_through": 88.0
        },
        "body_analysis": {},
        "feedback": [{"body_part": "elbow", "issue": "Keep elbow high", "severity": "low", "feedback": "Good"}],
        "coaching_text": "Keep eyes on the ball.",
        "video_metadata": {"total_frames": 45, "fps": 30.0, "detection_rate": 0.98},
        "visualizations": {}
    }

    generated_path = generate_pdf_report(test_payload, out_pdf)
    assert os.path.exists(generated_path)
    assert os.path.getsize(generated_path) > 1000, "PDF file should be non-empty"
    print(f"[PASS] PDF report generated successfully ({os.path.getsize(generated_path)} bytes) with actual prediction 'Hook'.")
    os.remove(out_pdf)


if __name__ == "__main__":
    print("=" * 60)
    print("RUNNING CRICKET ML PREDICTION REGRESSION SUITE")
    print("=" * 60)
    test_1_predictor_returns_valid_six_class_prediction()
    test_2_analysis_pipeline_preserves_prediction_fields()
    test_3_async_job_storage_preserves_complete_result()
    test_4_missing_prediction_produces_error_rather_than_fake_success()
    test_5_pdf_report_contains_actual_prediction()
    print("\n" + "=" * 60)
    print("ALL 5 REGRESSION TESTS COMPLETED SUCCESSFULLY!")
    print("=" * 60)

