import cv2
import numpy as np
import pandas as pd
import os

def _get_mp_pose():
    """Safely retrieves MediaPipe Pose solution module."""
    try:
        from mediapipe import solutions
        return solutions.pose
    except Exception:
        import mediapipe as mp
        return mp.solutions.pose

LANDMARK_NAMES = [
    "NOSE", "LEFT_EYE_INNER", "LEFT_EYE", "LEFT_EYE_OUTER",
    "RIGHT_EYE_INNER", "RIGHT_EYE", "RIGHT_EYE_OUTER",
    "LEFT_EAR", "RIGHT_EAR", "MOUTH_LEFT", "MOUTH_RIGHT",
    "LEFT_SHOULDER", "RIGHT_SHOULDER", "LEFT_ELBOW", "RIGHT_ELBOW",
    "LEFT_WRIST", "RIGHT_WRIST", "LEFT_PINKY", "RIGHT_PINKY",
    "LEFT_INDEX", "RIGHT_INDEX", "LEFT_THUMB", "RIGHT_THUMB",
    "LEFT_HIP", "RIGHT_HIP", "LEFT_KNEE", "RIGHT_KNEE",
    "LEFT_ANKLE", "RIGHT_ANKLE", "LEFT_HEEL", "RIGHT_HEEL",
    "LEFT_FOOT_INDEX", "RIGHT_FOOT_INDEX"
]

class PoseExtractor:
    """Extracts 33 MediaPipe body landmarks (x, y, z, visibility) from video frames."""
    
    def __init__(self, model_complexity=1, min_detection_confidence=0.3, min_tracking_confidence=0.3, static_image_mode=False):
        self.model_complexity = model_complexity
        self.min_detection_confidence = min_detection_confidence
        self.min_tracking_confidence = min_tracking_confidence
        self.static_image_mode = static_image_mode
        self.mp_pose = _get_mp_pose()
        self.pose = self.mp_pose.Pose(
            static_image_mode=self.static_image_mode,
            model_complexity=self.model_complexity,
            min_detection_confidence=self.min_detection_confidence,
            min_tracking_confidence=self.min_tracking_confidence
        )

    def extract_landmarks_from_video(self, video_path):
        """
        Extract pose landmarks for all frames in a video.
        Returns:
            np.ndarray: shape (T, 33, 4) where T is frame count.
            dict: Video metadata
        """
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")
            
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video file: {video_path}")

        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            # Compute aspect-ratio preserving processing resolution
            max_dim = int(os.getenv("ML_FRAME_MAX_DIM", "640"))
            needs_resize = False
            if max(width, height) > max_dim and max(width, height) > 0:
                scale = max_dim / float(max(width, height))
                target_w = int(round(width * scale))
                target_h = int(round(height * scale))
                needs_resize = True
            else:
                target_w, target_h = width, height

            raw_landmarks = []
            detected_frames = 0

            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break

                if needs_resize:
                    proc_frame = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_AREA)
                else:
                    proc_frame = frame

                rgb_frame = cv2.cvtColor(proc_frame, cv2.COLOR_BGR2RGB)
                results = self.pose.process(rgb_frame)

                if results.pose_landmarks:
                    detected_frames += 1
                    frame_lms = [[lm.x, lm.y, lm.z, lm.visibility] for lm in results.pose_landmarks.landmark]
                    raw_landmarks.append(frame_lms)
                else:
                    raw_landmarks.append([[np.nan, np.nan, np.nan, np.nan]] * 33)

                del frame, proc_frame, rgb_frame, results
        finally:
            cap.release()

        if len(raw_landmarks) == 0:
            raw_landmarks = [[[np.nan, np.nan, np.nan, np.nan]] * 33]

        raw_landmarks = np.array(raw_landmarks, dtype=np.float32) # (T, 33, 4)
        cleaned_landmarks = self.clean_and_interpolate_landmarks(raw_landmarks)

        metadata = {
            "fps": float(fps) if fps > 0 else 30.0,
            "width": int(width),
            "height": int(height),
            "total_frames": int(len(cleaned_landmarks)),
            "detected_frames": int(detected_frames),
            "detection_rate": float(detected_frames) / max(1, len(cleaned_landmarks))
        }

        return cleaned_landmarks, metadata

    def clean_and_interpolate_landmarks(self, landmarks):
        T, N, C = landmarks.shape
        flat_landmarks = landmarks.reshape(T, N * C)
        df = pd.DataFrame(flat_landmarks)
        df = df.interpolate(method='linear', limit_direction='both', axis=0)
        df = df.fillna(0.0)
        return df.values.reshape(T, N, C)

    def close(self):
        if self.pose:
            self.pose.close()
