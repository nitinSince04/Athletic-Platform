import sys
import os
from pathlib import Path
import hashlib

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ml.preprocessing.video_preprocessing import VideoPreprocessor
from ml.api.analyze import analyze_video
from ml.test_video import create_synthetic_cricket_video

def test_validate_video_signatures():
    video_path = create_synthetic_cricket_video("test_sig_clip.mp4", num_frames=15)
    preprocessor = VideoPreprocessor()

    # 1. Test call without precomputed_sha256 (positional argument only)
    meta_auto = preprocessor.validate_video(video_path)
    assert "video_hash" in meta_auto, "video_hash missing in auto validation"
    assert len(meta_auto["video_hash"]) == 64, "Expected valid 64-character SHA256"
    print("[PASS] validate_video(video_path) generated correct hash:", meta_auto["video_hash"][:16] + "...")

    # 2. Test call with explicit precomputed_sha256 keyword
    custom_sha256 = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
    meta_pre = preprocessor.validate_video(video_path, precomputed_sha256=custom_sha256)
    assert meta_pre["video_hash"] == custom_sha256, "Did not reuse precomputed_sha256"
    print("[PASS] validate_video(video_path, precomputed_sha256=...) correctly reused precomputed hash")

    # 3. Test call with precomputed_sha256=None
    meta_none = preprocessor.validate_video(video_path, precomputed_sha256=None)
    assert meta_none["video_hash"] == meta_auto["video_hash"], "None should fall back to auto computed hash"
    print("[PASS] validate_video(video_path, precomputed_sha256=None) correctly fell back to auto computation")

    # 4. Test analyze_video with precomputed_sha256
    res_pre = analyze_video(video_path, precomputed_sha256=custom_sha256)
    assert res_pre["video_metadata"]["video_hash"] == custom_sha256
    print("[PASS] analyze_video(video_path, precomputed_sha256=...) passed through to metadata")

    # 5. Clean up temporary test video
    if os.path.exists(video_path):
        os.remove(video_path)
    if os.path.exists("synthetic_cricket.mp4"):
        os.remove("synthetic_cricket.mp4")

    print("\nALL SIGNATURE & FUNCTIONALITY TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_validate_video_signatures()

