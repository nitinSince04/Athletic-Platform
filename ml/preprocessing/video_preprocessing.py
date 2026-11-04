import cv2
import os
import hashlib
import numpy as np

class VideoPreprocessor:
    """
    Handles video clip inspection, validation, SHA256 hashing, frame rate sampling, and RGB decoding.
    """
    
    @staticmethod
    def compute_sha256(video_path: str) -> str:
        """Calculates SHA256 hash of the video binary data."""
        sha256 = hashlib.sha256()
        with open(video_path, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                sha256.update(chunk)
        return sha256.hexdigest()

    def validate_video(self, video_path, precomputed_sha256=None):
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video file: {video_path}")
            
        try:
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

            # Sample pixel statistics across sampled frames to verify frame decoding
            sampled_means = []
            prev_frame = None
            frame_diffs = []

            step = max(1, total_frames // 10)
            idx = 0
            while cap.isOpened() and len(sampled_means) < 10:
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                ret, frame = cap.read()
                if not ret:
                    break
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                sampled_means.append(float(np.mean(gray)))
                if prev_frame is not None:
                    diff = float(np.mean(cv2.absdiff(gray, prev_frame)))
                    frame_diffs.append(diff)
                prev_frame = gray
                idx += step
        finally:
            cap.release()

        if precomputed_sha256:
            video_hash = precomputed_sha256
        else:
            video_hash = self.compute_sha256(video_path)
        file_size = os.path.getsize(video_path)

        return {
            "video_hash": video_hash,
            "file_size_bytes": file_size,
            "fps": float(fps),
            "width": width,
            "height": height,
            "total_frames": total_frames,
            "pixel_mean": float(np.mean(sampled_means)) if sampled_means else 0.0,
            "frame_diff_mean": float(np.mean(frame_diffs)) if frame_diffs else 0.0,
        }

