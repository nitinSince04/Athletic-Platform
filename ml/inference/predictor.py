import os
import json
import threading
import torch
import numpy as np
from pathlib import Path

from ml.models.bilstm import BiLSTMClassifier
from ml.models.cnn_bilstm import CNNBiLSTMClassifier
from ml.models.attention import BiLSTMAttentionClassifier

_global_predictor = None
_global_predictor_lock = threading.Lock()

def get_predictor(models_dir=None):
    """Thread-safe singleton getter to reuse a single loaded model instance."""
    global _global_predictor
    if _global_predictor is None:
        with _global_predictor_lock:
            if _global_predictor is None:
                _global_predictor = CricketStrokePredictor(models_dir=models_dir)
    return _global_predictor

class CricketStrokePredictor:
    """
    Loads saved model weights & metadata portably and performs thread-safe inference.
    """
    
    def __init__(self, models_dir=None):
        if models_dir is None:
            models_dir = Path(__file__).resolve().parents[1] / "models"

        self.models_dir = Path(models_dir)
        metadata_path = self.models_dir / "model_metadata.json"
        weights_path = self.models_dir / "best_model.pth"

        if not metadata_path.exists() or not weights_path.exists():
            raise FileNotFoundError(f"Model metadata or weights not found in {self.models_dir}")

        with open(metadata_path, "r") as f:
            self.metadata = json.load(f)

        self.model_name = self.metadata.get("best_model_name", "BiLSTM_Attention")
        self.class_names = self.metadata.get("class_names", ["Block", "Cut", "Glance", "Hook", "OffDrive", "OnDrive"])
        self.device = torch.device("cpu")
        self._inference_lock = threading.Lock()

        if self.model_name == "BiLSTM":
            self.model = BiLSTMClassifier(input_dim=528, hidden_dim=128, num_classes=len(self.class_names))
        elif self.model_name == "CNN_BiLSTM":
            self.model = CNNBiLSTMClassifier(input_dim=528, cnn_channels=128, hidden_dim=128, num_classes=len(self.class_names))
        elif self.model_name == "BiLSTM_Attention":
            self.model = BiLSTMAttentionClassifier(input_dim=528, hidden_dim=128, num_classes=len(self.class_names))
        else:
            raise ValueError(f"Unknown model name: {self.model_name}")

        state_dict = torch.load(weights_path, map_location=self.device)
        self.model.load_state_dict(state_dict)
        self.model.to(self.device)
        self.model.eval()

    def predict(self, norm_sequence):
        """
        Thread-safe inference using torch.inference_mode.
        Args:
            norm_sequence: np.ndarray of shape (30, 528) or (1, 30, 528)
        Returns:
            dict containing predicted_stroke, confidence, confidence_breakdown, and optional attention_weights
        """
        if isinstance(norm_sequence, np.ndarray):
            x_tensor = torch.from_numpy(norm_sequence).float()
        else:
            x_tensor = torch.tensor(norm_sequence, dtype=torch.float32)

        if x_tensor.ndim == 2:
            x_tensor = x_tensor.unsqueeze(0)  # (1, 30, 528)
        x_tensor = x_tensor.to(self.device)

        # Diagnostic logging
        has_nan = bool(torch.isnan(x_tensor).any().item())
        has_inf = bool(torch.isinf(x_tensor).any().item())
        feat_mean = float(x_tensor.mean().item())
        feat_std = float(x_tensor.std().item())
        feat_min = float(x_tensor.min().item())
        feat_max = float(x_tensor.max().item())

        print(f"[PREDICTOR DIAGNOSTIC] Model loaded: {self.model is not None} | Model name: {self.model_name}")
        print(f"[PREDICTOR DIAGNOSTIC] Input shape: {list(x_tensor.shape)} | dtype: {x_tensor.dtype}")
        print(f"[PREDICTOR DIAGNOSTIC] Input NaN check: {has_nan} | Inf check: {has_inf}")
        print(f"[PREDICTOR DIAGNOSTIC] Feature normalization stats - mean: {feat_mean:.4f}, std: {feat_std:.4f}, min: {feat_min:.4f}, max: {feat_max:.4f}")

        if has_nan or has_inf:
            print("[PREDICTOR WARNING] Input tensor contains NaN or Inf values! Sanitizing with nan_to_num...")
            x_tensor = torch.nan_to_num(x_tensor, nan=0.0, posinf=0.0, neginf=0.0)

        attn_weights = None
        with self._inference_lock:
            with torch.inference_mode():
                if self.model_name == "BiLSTM_Attention":
                    logits, attn_tensor = self.model(x_tensor, return_attention=True)
                    attn_weights = attn_tensor.squeeze(0).cpu().numpy().tolist()
                else:
                    logits = self.model(x_tensor)
                    if isinstance(logits, tuple):
                        logits = logits[0]
                
                probs = torch.softmax(logits, dim=1).squeeze(0).cpu().numpy()

        logits_list = logits.squeeze(0).cpu().numpy().tolist()
        pred_idx = int(np.argmax(probs))
        predicted_stroke = self.class_names[pred_idx]
        conf = float(probs[pred_idx])

        print(f"[PREDICTOR DIAGNOSTIC] Model logits: {[round(v, 4) for v in logits_list]}")
        print(f"[PREDICTOR DIAGNOSTIC] Softmax probabilities across all 6 classes:")
        for c_idx, c_name in enumerate(self.class_names):
            print(f"  [{c_idx}] {c_name:10s}: {probs[c_idx]:.4f} ({probs[c_idx]*100:.2f}%)")
        print(f"[PREDICTOR DIAGNOSTIC] Predicted class index: {pred_idx}")
        print(f"[PREDICTOR DIAGNOSTIC] Predicted stroke name: {predicted_stroke}")
        print(f"[PREDICTOR DIAGNOSTIC] Prediction confidence: {conf*100:.2f}%")

        confidence_breakdown = {self.class_names[i]: float(probs[i]) for i in range(len(self.class_names))}

        return {
            "class_id": pred_idx,
            "predicted_stroke": predicted_stroke,
            "stroke": predicted_stroke,
            "confidence": conf,
            "confidence_breakdown": confidence_breakdown,
            "attention_weights": attn_weights,
            "model_name": self.model_name,
            "class_names": list(self.class_names)
        }


