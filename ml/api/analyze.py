import os
import json
import gc
import time
import numpy as np

from ml.preprocessing.video_preprocessing import VideoPreprocessor
from ml.pose.pose_extractor import PoseExtractor
from ml.features.feature_engineering import FeatureEngineer
from ml.features.sequence_builder import SequenceBuilder
from ml.features.normalization import FeatureNormalizer, get_normalizer
from ml.inference.predictor import CricketStrokePredictor, get_predictor
from ml.analysis.pose_analysis import TechniqueAnalyzer
from ml.analysis.scoring import TechniqueScorer
from ml.analysis.feedback import FeedbackGenerator
from ml.analysis.visualizer import VisualizationGenerator


def _ts():
    """Returns ISO-8601 timestamp string for logging."""
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def analyze_video(video_path, predictor=None, normalizer=None, precomputed_sha256=None):
    """
    Complete End-to-End Portable ML Inference Entry Point.

    Args:
        video_path (str): Absolute or relative path to input video file.
        predictor (CricketStrokePredictor, optional): Shared preloaded predictor instance.
        normalizer (FeatureNormalizer, optional): Shared preloaded normalizer instance.
        precomputed_sha256 (str, optional): SHA256 hex already computed during download
            to avoid a second full-file read.

    Returns:
        dict: Clean, JSON-serializable dictionary containing:
            - prediction (stroke, confidence, confidence_breakdown)
            - scores (overall, head, shoulder, elbow, hand, hip, feet, balance, follow_through)
            - body_analysis (head, shoulder, elbow, hand, hip, feet, timing)
            - feedback (list of structured feedback items)
            - coaching_text (stroke-specific coaching guidance)
            - video_metadata (resolution, fps, total_frames, detection_rate)
            - visualizations (scoreBreakdown, predictionConfidence, landmarkTrajectory, jointAngles, stability)
            - timing (per-stage elapsed seconds)
    """
    timings = {}

    # 1. Preprocess & Validate Video
    t0 = time.time()
    print(f"[{_ts()}] [Pipeline] Stage 1/10: Video validation...")
    preprocessor = VideoPreprocessor()
    meta = preprocessor.validate_video(video_path, precomputed_sha256=precomputed_sha256)
    timings["validate_video"] = round(time.time() - t0, 2)
    print(f"[{_ts()}] [Pipeline] Stage 1/10 done in {timings['validate_video']}s — "
          f"{meta.get('total_frames', 0)} frames, {meta.get('width')}x{meta.get('height')}")

    # 2. Extract Pose Landmarks (T, 33, 4)
    t0 = time.time()
    print(f"[{_ts()}] [Pipeline] Stage 2/10: MediaPipe pose extraction...")
    extractor = PoseExtractor(model_complexity=0, static_image_mode=False)
    try:
        landmarks, pose_meta = extractor.extract_landmarks_from_video(video_path)
    finally:
        extractor.close()
    timings["pose_extraction"] = round(time.time() - t0, 2)
    print(f"[{_ts()}] [Pipeline] Stage 2/10 done in {timings['pose_extraction']}s — "
          f"{pose_meta['detected_frames']}/{len(landmarks)} frames detected")

    # Update metadata with pose detection statistics
    meta["detected_frames"] = pose_meta["detected_frames"]
    meta["detection_rate"] = pose_meta["detection_rate"]

    # 3. Feature Engineering (T, 528)
    t0 = time.time()
    print(f"[{_ts()}] [Pipeline] Stage 3/10: Feature engineering (528 features)...")
    fe = FeatureEngineer()
    raw_features = fe.compute_features_sequence(landmarks)
    timings["feature_engineering"] = round(time.time() - t0, 2)
    print(f"[{_ts()}] [Pipeline] Stage 3/10 done in {timings['feature_engineering']}s — shape {raw_features.shape}")

    # 4. Sequence Resampling (30, 528)
    t0 = time.time()
    print(f"[{_ts()}] [Pipeline] Stage 4/10: Sequence resampling to 30 frames...")
    sb = SequenceBuilder(target_length=30)
    seq_528 = sb.build_sequence(raw_features)
    del raw_features
    timings["sequence_building"] = round(time.time() - t0, 2)
    print(f"[{_ts()}] [Pipeline] Stage 4/10 done in {timings['sequence_building']}s")

    # 5. Normalization using saved mean/std (reusing shared singleton instance)
    t0 = time.time()
    print(f"[{_ts()}] [Pipeline] Stage 5/10: Normalization...")
    if normalizer is None:
        normalizer = get_normalizer()
    norm_seq = normalizer.transform(seq_528)
    timings["normalization"] = round(time.time() - t0, 2)
    print(f"[{_ts()}] [Pipeline] Stage 5/10 done in {timings['normalization']}s")

    # 6. Model Prediction (reusing shared singleton predictor instance)
    t0 = time.time()
    print(f"[{_ts()}] [Pipeline] Stage 6/10: BiLSTM model inference...")
    if predictor is None:
        predictor = get_predictor()
    pred_res = predictor.predict(norm_seq)
    timings["model_inference"] = round(time.time() - t0, 2)
    print(f"[{_ts()}] [Pipeline] Stage 6/10 done in {timings['model_inference']}s — "
          f"predicted '{pred_res['predicted_stroke']}' ({pred_res['confidence']*100:.1f}%)")

    # ML INFERENCE DEBUG BOX
    print("=" * 50)
    print("ML INFERENCE DEBUG")
    print("=" * 50)
    print(f"Video Path: {video_path}")
    print(f"Video Size: {meta.get('file_size_bytes', 0)} bytes")
    print(f"Video SHA256 Hash: {meta.get('video_hash', 'N/A')}")
    print(f"Resolution: {meta.get('width', 0)}x{meta.get('height', 0)} | FPS: {meta.get('fps', 0)} | Frames: {meta.get('total_frames', 0)}")
    print(f"Pose frames detected: {meta.get('detected_frames', 0)} / {meta.get('total_frames', 0)} (Rate: {round(meta.get('detection_rate', 0)*100, 1)}%)")
    print(f"Feature matrix shape: {seq_528.shape}")
    print(f"Feature mean: {float(np.mean(seq_528)):.4f} | std: {float(np.std(seq_528)):.4f} | min: {float(np.min(seq_528)):.4f} | max: {float(np.max(seq_528)):.4f}")
    print(f"Normalized mean: {float(np.mean(norm_seq)):.4f} | std: {float(np.std(norm_seq)):.4f}")
    print("Prediction probabilities:")
    for stroke_cls, prob_val in pred_res["confidence_breakdown"].items():
        print(f"  {stroke_cls:10s}: {prob_val:.4f} ({prob_val*100:.2f}%)")
    print(f"Predicted Class ID: {pred_res.get('class_id', 'N/A')}")
    print(f"Predicted Shot: {pred_res['predicted_stroke']}")
    print(f"Confidence: {pred_res['confidence']*100:.2f}%")
    print("=" * 50)

    # 7. Body Position Analysis
    t0 = time.time()
    print(f"[{_ts()}] [Pipeline] Stage 7/10: Biomechanical pose analysis...")
    # Resample 3D landmarks to 30 frames for spatial analysis
    landmarks_30 = sb.build_sequence(landmarks.reshape(len(landmarks), -1)).reshape(30, 33, 4)
    analyzer = TechniqueAnalyzer()
    body_analysis = analyzer.analyze_pose_sequence(landmarks_30)
    timings["pose_analysis"] = round(time.time() - t0, 2)
    print(f"[{_ts()}] [Pipeline] Stage 7/10 done in {timings['pose_analysis']}s")

    # 8. Technique Scoring
    t0 = time.time()
    print(f"[{_ts()}] [Pipeline] Stage 8/10: Technique scoring...")
    scorer = TechniqueScorer()
    scores = scorer.compute_scores(body_analysis)
    timings["scoring"] = round(time.time() - t0, 2)
    print(f"[{_ts()}] [Pipeline] Stage 8/10 done in {timings['scoring']}s — overall={scores.get('overall', 0)}")

    # 9. Feedback & Coaching Advice
    t0 = time.time()
    print(f"[{_ts()}] [Pipeline] Stage 9/10: Feedback generation...")
    fg = FeedbackGenerator()
    feedback_items, coaching_text = fg.generate_feedback(scores, pred_res["predicted_stroke"])
    timings["feedback"] = round(time.time() - t0, 2)
    print(f"[{_ts()}] [Pipeline] Stage 9/10 done in {timings['feedback']}s — {len(feedback_items)} items")

    # 10. Matplotlib & Seaborn Visualizations Generation
    t0 = time.time()
    print(f"[{_ts()}] [Pipeline] Stage 10/10: Visualization chart generation...")
    predicted_stroke_name = pred_res.get("stroke") or pred_res.get("predicted_stroke") or "Unknown"
    pred_dict = {
        "stroke": predicted_stroke_name,
        "predicted_stroke": predicted_stroke_name,
        "confidence": round(float(pred_res.get("confidence", 0.0)), 4),
        "confidence_breakdown": {k: round(float(v), 4) for k, v in pred_res.get("confidence_breakdown", {}).items()},
        "class_id": int(pred_res.get("class_id", 0))
    }

    # Strict validation: prevent marking incomplete or unknown analysis as success
    if not pred_dict["stroke"] or pred_dict["stroke"] == "Unknown":
        raise ValueError("ML analysis failed: Predicted stroke is unknown or missing.")
    if pred_dict["confidence"] <= 0.0:
        raise ValueError(f"ML analysis failed: Prediction confidence must be > 0, got {pred_dict['confidence']}")
    if not scores or scores.get("overall") is None:
        raise ValueError("ML analysis failed: Technique scoring engine produced invalid or missing scores.")

    vg = VisualizationGenerator()
    visualizations = vg.generate_all_visualizations(body_analysis, scores, pred_dict, landmarks_30)
    timings["visualization"] = round(time.time() - t0, 2)
    print(f"[{_ts()}] [Pipeline] Stage 10/10 done in {timings['visualization']}s")

    # 11. Clean up intermediate arrays
    del landmarks, landmarks_30, seq_528, norm_seq
    gc.collect()

    # 12. Construct Final Result Dictionary
    return {
        "prediction": pred_dict,
        "scores": scores,
        "body_analysis": body_analysis,
        "feedback": feedback_items,
        "coaching_text": coaching_text,
        "video_metadata": meta,
        "visualizations": visualizations,
        "timing": timings,
    }


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        v_path = sys.argv[1]
        res = analyze_video(v_path)
        print(json.dumps(res, indent=2))
