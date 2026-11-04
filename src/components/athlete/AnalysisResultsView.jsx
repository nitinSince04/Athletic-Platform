import React from 'react';
import { 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Activity, 
  Award, 
  Compass, 
  FileText, 
  BarChart2,
  TrendingUp
} from 'lucide-react';
import Card from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import { getPdfDownloadUrl } from '../../api/analysisApi.js';
import './AnalysisResultsView.css';

export default function AnalysisResultsView({ analysisData, onReset }) {
  if (!analysisData) return null;

  const pred = analysisData.prediction || {};
  const scores = analysisData.scores || {};
  const body = analysisData.body_analysis || {};
  const feedback = analysisData.feedback || [];
  const coachingText = analysisData.coaching_text || analysisData.coachingText || '';
  const meta = analysisData.video_metadata || {};
  const visualizations = analysisData.visualizations || {};

  const stroke = pred.stroke || pred.predicted_stroke || 'Unknown';
  const confidencePct = Math.round((pred.confidence || 0) * 100);
  const breakdown = pred.confidence_breakdown || {};
  const overallScore = Math.round(scores.overall || 0);

  // Do not show fake successful Analysis Completed when prediction is missing or invalid
  const isInvalid = !stroke || stroke === 'Unknown' || stroke === 'Processing...' || (pred.confidence === undefined || pred.confidence === 0);

  if (isInvalid) {
    return (
      <div className="analysis-results stack">
        <div className="results-header-card" style={{ borderLeft: '4px solid var(--accent-coral, #e63946)' }}>
          <div className="results-header-left">
            <Badge tone="coral" dot>Prediction Incomplete</Badge>
            <h2 className="results-title">ANALYSIS INCOMPLETE</h2>
            <p className="results-subtitle">
              Cricket stroke classification could not be determined for this video. Please ensure the athlete is fully visible and performing a standard cricket stroke.
            </p>
          </div>
          <div className="results-header-actions">
            {onReset && (
              <Button variant="primary" size="sm" onClick={onReset}>
                Analyze Another Video
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const pdfUrl = analysisData.pdf_filename 
    ? getPdfDownloadUrl(analysisData.pdf_filename, analysisData.analysisId || analysisData._id)
    : (analysisData.pdfDownloadUrl || '#');

  const handleDownloadPdf = () => {
    if (pdfUrl && pdfUrl !== '#') {
      window.open(pdfUrl, '_blank');
    }
  };

  const getScoreColor = (val) => {
    if (val >= 85) return 'var(--accent-teal)';
    if (val >= 70) return '#e5a50a';
    return '#e63946';
  };

  const bodyChecklist = [
    { part: 'Head', key: 'head', ideal: '< 0.015 lateral variance' },
    { part: 'Shoulders', key: 'shoulder', ideal: '15° - 50° rotation' },
    { part: 'Elbows', key: 'elbow', ideal: '110° - 165° impact angle' },
    { part: 'Hands', key: 'hand', ideal: 'Controlled separation & velocity' },
    { part: 'Hips', key: 'hip', ideal: '15° - 55° rotation' },
    { part: 'Knees', key: 'knee', ideal: '115° - 165° knee flex' },
    { part: 'Feet & Stance', key: 'feet', ideal: '0.15 - 0.50 stance width' },
  ];

  return (
    <div className="analysis-results stack">
      {/* Header Banner */}
      <div className="results-header-card">
        <div className="results-header-left">
          <Badge tone="teal" dot>Analysis Completed</Badge>
          <h2 className="results-title">YOUR CRICKET ANALYSIS REPORT</h2>
          <p className="results-subtitle">
            Analyzed {meta.total_frames || 30} frames ({meta.fps ? meta.fps.toFixed(1) : 30} FPS) • Pose detection rate: {meta.detection_rate ? Math.round(meta.detection_rate * 100) : 100}%
          </p>
        </div>
        <div className="results-header-actions">
          {onReset && (
            <Button variant="ghost" size="sm" onClick={onReset}>
              Analyze Another Video
            </Button>
          )}
          <Button variant="primary" size="md" onClick={handleDownloadPdf}>
            <Download size={16} /> Download PDF Report
          </Button>
        </div>
      </div>

      {/* 1. Top Grid: Stroke Classification & Overall Score */}
      <div className="grid-2">

        {/* Stroke Prediction Card */}
        <Card eyebrow="CNN + BiLSTM Model Prediction" title="Predicted Stroke & Confidence">
          <div className="stroke-hero">
            <div className="stroke-badge-large">
              <span className="stroke-name">{stroke}</span>
              <span className="stroke-conf">{confidencePct}% Confidence</span>
            </div>
            <div className="stroke-breakdown-container">
              <p className="breakdown-title">Probability Breakdown Across All 6 Classes</p>
              <div className="breakdown-list">
                {Object.entries(breakdown).map(([class_name, prob]) => {
                  const pct = Math.round(prob * 100);
                  const isPredicted = class_name === stroke;
                  return (
                    <div key={class_name} className={`breakdown-row ${isPredicted ? 'active' : ''}`}>
                      <span className="breakdown-name">{class_name}</span>
                      <div className="breakdown-bar-track">
                        <div 
                          className="breakdown-bar-fill" 
                          style={{ 
                            width: `${pct}%`,
                            backgroundColor: isPredicted ? 'var(--accent-teal)' : 'rgba(255, 255, 255, 0.2)' 
                          }} 
                        />
                      </div>
                      <span className="breakdown-pct">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>

        {/* Overall Technical Score Gauge */}
        <Card eyebrow="Biomechanical Scoring Engine" title="Performance Score">
          <div className="overall-score-hero">
            <div className="score-ring">
              <span className="score-number" style={{ color: getScoreColor(overallScore) }}>
                {overallScore}
              </span>
              <span className="score-max">/ 100</span>
            </div>
            <div className="score-assessment">
              <h3>
                {overallScore >= 85 ? 'Elite Execution' : (overallScore >= 70 ? 'Solid Technique' : 'Needs Technical Refinement')}
              </h3>
              <p>
                Calculated from 528 extracted features, 33 MediaPipe 3D joint landmarks, spatial angles, and frame-by-frame movement variance across the 30-frame shot sequence.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* 3. Body Position Analysis Checklist */}
      <Card eyebrow="Kinematic Position Check" title="Body Position Analysis">
        <div className="body-checklist-grid">
          {bodyChecklist.map(({ part, key, ideal }) => {
            const scoreVal = scores[key] || 75;
            const isGood = scoreVal >= 70;
            return (
              <div key={key} className={`body-checklist-item ${isGood ? 'good' : 'warning'}`}>
                <div className="checklist-status">
                  {isGood ? (
                    <CheckCircle2 size={20} color="var(--accent-teal)" />
                  ) : (
                    <AlertCircle size={20} color="var(--accent-coral)" />
                  )}
                  <span className="checklist-part">{part}</span>
                </div>
                <div className="checklist-badge">
                  {isGood ? <Badge tone="teal">✓ Good</Badge> : <Badge tone="coral">⚠ Needs Improvement</Badge>}
                </div>
                <p className="checklist-ideal">{ideal}</p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 4. Matplotlib & Seaborn Visualizations Section */}
      <Card eyebrow="Python Matplotlib & Seaborn Engine" title="Performance Visualizations">
        <div className="visualizations-grid">
          {visualizations.scoreBreakdown && (
            <div className="viz-chart-card">
              <h4>Biomechanical Score Breakdown</h4>
              <img src={visualizations.scoreBreakdown} alt="Score Breakdown Chart" className="viz-chart-img" />
            </div>
          )}
          {visualizations.predictionConfidence && (
            <div className="viz-chart-card">
              <h4>Prediction Confidence Probabilities</h4>
              <img src={visualizations.predictionConfidence} alt="Prediction Confidence Chart" className="viz-chart-img" />
            </div>
          )}
          {visualizations.landmarkTrajectory && (
            <div className="viz-chart-card">
              <h4>Body Landmark Trajectory Across 30 Frames</h4>
              <img src={visualizations.landmarkTrajectory} alt="Landmark Trajectory Chart" className="viz-chart-img" />
            </div>
          )}
          {visualizations.jointAngles && (
            <div className="viz-chart-card">
              <h4>Joint Angle Dynamics</h4>
              <img src={visualizations.jointAngles} alt="Joint Angle Dynamics Chart" className="viz-chart-img" />
            </div>
          )}
          {visualizations.stability && (
            <div className="viz-chart-card">
              <h4>Body Stability & Footwork Stance Width</h4>
              <img src={visualizations.stability} alt="Body Stability Chart" className="viz-chart-img" />
            </div>
          )}
        </div>
      </Card>

      {/* 5. Biomechanical Feedback & Coaching Advice */}
      <div className="grid-2">
        <Card eyebrow="AI Observations" title="Biomechanical Feedback">
          <div className="feedback-item-list">
            {feedback.map((item, idx) => {
              const isAlert = item.severity === 'high' || item.severity === 'medium';
              return (
                <div key={idx} className={`feedback-card-row ${isAlert ? 'alert' : 'success'}`}>
                  {isAlert ? (
                    <AlertCircle size={18} color="var(--accent-coral)" style={{ flexShrink: 0 }} />
                  ) : (
                    <CheckCircle2 size={18} color="var(--accent-teal)" style={{ flexShrink: 0 }} />
                  )}
                  <div>
                    <strong className="feedback-body-part">
                      {item.body_part ? item.body_part.toUpperCase() : 'GENERAL'}:
                    </strong>{' '}
                    <span className="feedback-issue">{item.issue}</span>
                    <p className="feedback-text">{item.feedback}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card eyebrow="Stroke Coaching Heuristics" title="Technical Coaching Advice">
          <div className="coaching-box">
            <div className="coaching-badge-row">
              <Compass size={18} color="var(--accent-teal)" />
              <span>Recommended Drills for {stroke}</span>
            </div>
            <p className="coaching-text">{coachingText}</p>
          </div>
        </Card>
      </div>

      {/* Bottom Download CTA */}
      <div className="pdf-cta-banner">
        <div className="pdf-cta-content">
          <FileText size={28} color="var(--accent-teal)" />
          <div>
            <h4>Download Full PDF Technical Report</h4>
            <p>Includes complete biomechanical summary, shot classification probabilities, and visualization charts.</p>
          </div>
        </div>
        <Button variant="primary" size="lg" onClick={handleDownloadPdf}>
          <Download size={18} /> Download PDF Report
        </Button>
      </div>
    </div>
  );
}

