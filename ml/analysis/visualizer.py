import os
import tempfile
import uuid
import numpy as np

# Ensure writable matplotlib config directory for Linux / Render / Serverless
if "MPLCONFIGDIR" not in os.environ:
    os.environ["MPLCONFIGDIR"] = os.path.join(tempfile.gettempdir(), "matplotlib")

import matplotlib
matplotlib.use('Agg')  # Headless non-interactive server backend
import matplotlib.pyplot as plt

class VisualizationGenerator:
    """
    Generates Matplotlib and Seaborn analytical charts from actual pose & ML model outputs.
    Exports high-resolution PNG chart figures for frontend rendering and PDF embedding.
    """

    def __init__(self, output_dir=None):
        if output_dir is None:
            output_dir = os.path.join(os.path.dirname(__file__), "..", "reports", "generated")
        self.output_dir = os.path.abspath(output_dir)
        os.makedirs(self.output_dir, exist_ok=True)

        # Athletic dark theme palette consistent with UI design system
        self.bg_color = "#0D1B2A"        # Near-black dark navy ground
        self.panel_color = "#1B263B"     # Raised panel slate
        self.text_color = "#E0E1DD"      # Light grey text
        self.accent_teal = "#00B4D8"     # Mint teal accent
        self.accent_coral = "#FF6B6B"    # Coral accent
        self.accent_gold = "#E5A50A"     # Warning gold accent
        self.grid_color = "#2D3748"      # Subtle grid line

        plt.style.use('dark_background')

    def _setup_figure(self, title, figsize=(7, 4)):
        fig, ax = plt.subplots(figsize=figsize, facecolor=self.bg_color)
        ax.set_facecolor(self.panel_color)
        ax.tick_params(colors=self.text_color, labelsize=9)
        for spine in ax.spines.values():
            spine.set_color(self.grid_color)
            spine.set_linewidth(1)
        ax.grid(True, linestyle='--', alpha=0.3, color=self.grid_color)
        ax.set_title(title, fontsize=12, fontweight='bold', color=self.text_color, pad=12)
        return fig, ax

    def plot_score_breakdown(self, scores, filename):
        """Creates horizontal bar chart of technical component scores (0-100)."""
        fig, ax = self._setup_figure("Biomechanical Score Breakdown (0-100)")

        categories = [
            ("Overall", scores.get("overall", 0)),
            ("Head Stability", scores.get("head", 0)),
            ("Shoulders", scores.get("shoulder", 0)),
            ("Lead Elbow", scores.get("elbow", 0)),
            ("Hand Control", scores.get("hand", 0)),
            ("Hip Rotation", scores.get("hip", 0)),
            ("Knee Position", scores.get("knee", 0)),
            ("Footwork", scores.get("feet", 0)),
            ("Balance", scores.get("balance", 0)),
            ("Follow Through", scores.get("follow_through", 0))
        ]

        labels = [item[0] for item in categories]
        values = [item[1] for item in categories]

        colors = [
            self.accent_teal if v >= 80 else (self.accent_gold if v >= 65 else self.accent_coral)
            for v in values
        ]

        y_pos = np.arange(len(labels))
        bars = ax.barh(y_pos, values, color=colors, height=0.6, edgecolor=self.bg_color)

        ax.set_yticks(y_pos)
        ax.set_yticklabels(labels, color=self.text_color, fontsize=9)
        ax.invert_yaxis()  # top-down label order
        ax.set_xlim(0, 105)
        ax.set_xlabel("Score / 100", color=self.text_color, fontsize=9)

        # Annotate exact score on each bar
        for bar in bars:
            width = bar.get_width()
            ax.text(
                width + 1.5,
                bar.get_y() + bar.get_height() / 2.0,
                f"{width:.1f}",
                ha='left',
                va='center',
                color=self.text_color,
                fontsize=8.5,
                fontweight='bold'
            )

        plt.tight_layout()
        filepath = os.path.join(self.output_dir, filename)
        fig.savefig(filepath, dpi=150, facecolor=fig.get_facecolor(), bbox_inches='tight')
        plt.close(fig)
        return filepath

    def plot_prediction_confidence(self, breakdown, predicted_stroke, filename):
        """Creates bar chart of model stroke classification probabilities across all 6 classes."""
        fig, ax = self._setup_figure("Stroke Prediction Class Probabilities")

        classes = ["Block", "Cut", "Glance", "Hook", "OffDrive", "OnDrive"]
        probs = [breakdown.get(cls, 0.0) * 100 for cls in classes]

        colors = [self.accent_teal if cls == predicted_stroke else "#4A5568" for cls in classes]

        bars = ax.bar(classes, probs, color=colors, width=0.55, edgecolor=self.bg_color)
        ax.set_ylim(0, max(max(probs) + 15, 100))
        ax.set_ylabel("Probability (%)", color=self.text_color, fontsize=9)

        for bar in bars:
            height = bar.get_height()
            ax.text(
                bar.get_x() + bar.get_width() / 2.0,
                height + 2.0,
                f"{height:.1f}%",
                ha='center',
                va='bottom',
                color=self.text_color,
                fontsize=8.5,
                fontweight='bold'
            )

        plt.tight_layout()
        filepath = os.path.join(self.output_dir, filename)
        fig.savefig(filepath, dpi=150, facecolor=fig.get_facecolor(), bbox_inches='tight')
        plt.close(fig)
        return filepath

    def plot_landmark_trajectory(self, landmarks_3d, filename):
        """Plots 3D body landmark movement (Head, Shoulders, Wrists, Hips, Knees, Ankles) across 30 frames."""
        fig, ax = self._setup_figure("Body Landmark Trajectory Across 30 Frames")

        T = len(landmarks_3d)
        frames = np.arange(1, T + 1)

        # Landmark indices
        nose = landmarks_3d[:, 0, :2]            # Head
        l_shoulder = landmarks_3d[:, 11, :2]
        r_shoulder = landmarks_3d[:, 12, :2]
        l_wrist = landmarks_3d[:, 15, :2]
        r_wrist = landmarks_3d[:, 16, :2]
        l_knee = landmarks_3d[:, 25, :2]
        r_knee = landmarks_3d[:, 26, :2]

        # Calculate Y-axis displacement (height movement) relative to first frame
        ax.plot(frames, nose[:, 1] - nose[0, 1], label="Head (Nose)", color="#00B4D8", linewidth=2)
        ax.plot(frames, l_shoulder[:, 1] - l_shoulder[0, 1], label="Left Shoulder", color="#48CAE4", linewidth=1.5, linestyle="--")
        ax.plot(frames, r_shoulder[:, 1] - r_shoulder[0, 1], label="Right Shoulder", color="#90E0EF", linewidth=1.5, linestyle="--")
        ax.plot(frames, l_wrist[:, 1] - l_wrist[0, 1], label="Left Wrist", color="#FF6B6B", linewidth=2)
        ax.plot(frames, r_wrist[:, 1] - r_wrist[0, 1], label="Right Wrist", color="#FF8E8E", linewidth=1.5, linestyle=":")
        ax.plot(frames, l_knee[:, 1] - l_knee[0, 1], label="Left Knee", color="#E5A50A", linewidth=1.5)

        ax.set_xlabel("Frame Number (1 - 30)", color=self.text_color, fontsize=9)
        ax.set_ylabel("Vertical Position Delta (Normalized)", color=self.text_color, fontsize=9)
        ax.legend(loc="upper right", facecolor=self.panel_color, edgecolor=self.grid_color, labelcolor=self.text_color, fontsize=8)

        plt.tight_layout()
        filepath = os.path.join(self.output_dir, filename)
        fig.savefig(filepath, dpi=150, facecolor=fig.get_facecolor(), bbox_inches='tight')
        plt.close(fig)
        return filepath

    def plot_joint_angles(self, landmarks_3d, filename):
        """Plots joint angles over time (Lead/Rear Elbow, Left/Right Knee)."""
        fig, ax = self._setup_figure("Joint Angle Dynamics Over Shot Sequence")

        T = len(landmarks_3d)
        frames = np.arange(1, T + 1)

        from ml.analysis.pose_analysis import calculate_angle_3pts

        lead_elbow, rear_elbow, left_knee, right_knee = [], [], [], []
        for t in range(T):
            # Left Elbow
            ls, le, lw = landmarks_3d[t, 11, :3], landmarks_3d[t, 13, :3], landmarks_3d[t, 15, :3]
            lead_elbow.append(calculate_angle_3pts(ls, le, lw))

            # Right Elbow
            rs, re, rw = landmarks_3d[t, 12, :3], landmarks_3d[t, 14, :3], landmarks_3d[t, 16, :3]
            rear_elbow.append(calculate_angle_3pts(rs, re, rw))

            # Left Knee
            lh, lk, la = landmarks_3d[t, 23, :3], landmarks_3d[t, 25, :3], landmarks_3d[t, 27, :3]
            left_knee.append(calculate_angle_3pts(lh, lk, la))

            # Right Knee
            rh, rk, ra = landmarks_3d[t, 24, :3], landmarks_3d[t, 26, :3], landmarks_3d[t, 28, :3]
            right_knee.append(calculate_angle_3pts(rh, rk, ra))

        ax.plot(frames, lead_elbow, label="Lead (Left) Elbow Angle", color=self.accent_teal, linewidth=2)
        ax.plot(frames, rear_elbow, label="Rear (Right) Elbow Angle", color="#48CAE4", linewidth=1.5, linestyle="--")
        ax.plot(frames, left_knee, label="Left Knee Angle", color=self.accent_gold, linewidth=1.5)
        ax.plot(frames, right_knee, label="Right Knee Angle", color=self.accent_coral, linewidth=1.5, linestyle=":")

        ax.set_xlabel("Frame Number (1 - 30)", color=self.text_color, fontsize=9)
        ax.set_ylabel("Joint Angle (Degrees °)", color=self.text_color, fontsize=9)
        ax.legend(loc="upper right", facecolor=self.panel_color, edgecolor=self.grid_color, labelcolor=self.text_color, fontsize=8)

        plt.tight_layout()
        filepath = os.path.join(self.output_dir, filename)
        fig.savefig(filepath, dpi=150, facecolor=fig.get_facecolor(), bbox_inches='tight')
        plt.close(fig)
        return filepath

    def plot_body_stability(self, landmarks_3d, filename):
        """Plots stance width and pelvis lateral stability across the sequence."""
        fig, ax = self._setup_figure("Body Stability & Footwork Stance Width")

        T = len(landmarks_3d)
        frames = np.arange(1, T + 1)

        # Stance width (distance between left and right ankles)
        stance_width = np.linalg.norm(landmarks_3d[:, 27, :2] - landmarks_3d[:, 28, :2], axis=1)

        # Pelvis center (midpoint of hips)
        pelvis = (landmarks_3d[:, 23, :2] + landmarks_3d[:, 24, :2]) / 2.0
        pelvis_lateral = pelvis[:, 0] - pelvis[0, 0]

        ax.plot(frames, stance_width, label="Stance Width (Ankle Separation)", color=self.accent_teal, linewidth=2)
        ax.plot(frames, pelvis_lateral, label="Pelvis Lateral Movement", color=self.accent_coral, linewidth=1.5, linestyle="--")

        ax.set_xlabel("Frame Number (1 - 30)", color=self.text_color, fontsize=9)
        ax.set_ylabel("Normalized Distance", color=self.text_color, fontsize=9)
        ax.legend(loc="upper right", facecolor=self.panel_color, edgecolor=self.grid_color, labelcolor=self.text_color, fontsize=8)

        plt.tight_layout()
        filepath = os.path.join(self.output_dir, filename)
        fig.savefig(filepath, dpi=150, facecolor=fig.get_facecolor(), bbox_inches='tight')
        plt.close(fig)
        return filepath

    def generate_all_visualizations(self, body_analysis, scores, prediction, landmarks_3d):
        """
        Generates all 5 Matplotlib & Seaborn chart PNG files and returns dictionary of filenames and paths.
        """
        prefix = f"chart_{uuid.uuid4().hex[:8]}"

        score_file = f"{prefix}_score_breakdown.png"
        conf_file = f"{prefix}_confidence.png"
        traj_file = f"{prefix}_trajectory.png"
        angles_file = f"{prefix}_joint_angles.png"
        stab_file = f"{prefix}_stability.png"

        try:
            p_score = self.plot_score_breakdown(scores, score_file)
            p_conf = self.plot_prediction_confidence(
                prediction.get("confidence_breakdown", {}),
                prediction.get("stroke", ""),
                conf_file
            )
            p_traj = self.plot_landmark_trajectory(landmarks_3d, traj_file)
            p_angles = self.plot_joint_angles(landmarks_3d, angles_file)
            p_stab = self.plot_body_stability(landmarks_3d, stab_file)

            return {
                "scoreBreakdown": score_file,
                "predictionConfidence": conf_file,
                "landmarkTrajectory": traj_file,
                "jointAngles": angles_file,
                "stability": stab_file,
                "_paths": {
                    "scoreBreakdown": p_score,
                    "predictionConfidence": p_conf,
                    "landmarkTrajectory": p_traj,
                    "jointAngles": p_angles,
                    "stability": p_stab
                }
            }
        except Exception as e:
            print(f"[Visualization Engine Warning] Failed to generate complete charts: {e}")
            return {
                "scoreBreakdown": "",
                "predictionConfidence": "",
                "landmarkTrajectory": "",
                "jointAngles": "",
                "stability": "",
                "_paths": {}
            }
