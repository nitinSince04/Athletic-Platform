import numpy as np
import os
import threading
from pathlib import Path

_global_normalizer = None
_global_normalizer_lock = threading.Lock()

def get_normalizer(input_dir=None):
    """Thread-safe singleton getter to reuse pre-loaded normalization parameters."""
    global _global_normalizer
    if _global_normalizer is None:
        with _global_normalizer_lock:
            if _global_normalizer is None:
                norm = FeatureNormalizer()
                norm.load_params(input_dir=input_dir)
                _global_normalizer = norm
    return _global_normalizer

class FeatureNormalizer:
    """
    Fits feature mean and standard deviation ONLY on training data.
    Saves preprocessing artifacts and applies normalization to inference data.
    """
    
    def __init__(self, mean=None, std=None):
        self.mean = mean
        self.std = std

    def transform(self, X):
        """
        Args:
            X: np.ndarray of shape (N, T, F), (T, F), or (F,)
        Returns:
            np.ndarray: normalized features
        """
        if self.mean is None or self.std is None:
            raise ValueError("FeatureNormalizer is not fitted yet! Call load_params() first.")
        
        return (X - self.mean) / (self.std + 1e-8)

    def load_params(self, input_dir=None):
        if input_dir is None:
            input_dir = Path(__file__).resolve().parents[1] / "assets"

        mean_path = os.path.join(input_dir, "feature_mean.npy")
        std_path = os.path.join(input_dir, "feature_std.npy")
        
        if not os.path.exists(mean_path) or not os.path.exists(std_path):
            raise FileNotFoundError(f"Normalizer artifacts not found in {input_dir}")
            
        self.mean = np.load(mean_path)
        self.std = np.load(std_path)
