import { useState, useEffect } from "react";
import Card from "../ui/Card.jsx";
import { LoadingBlock } from "../ui/LoadingState.jsx";
import AccuracyErrorChart from "../charts/AccuracyErrorChart.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { getAccuracyErrorTrend } from "../../api/mockApi.js";
import { getAnalysisSessions as getBackendSessions, getAnalysisSessionById } from "../../api/analysisApi.js";
import SessionList from "./SessionList.jsx";
import VideoUploadPanel from "./VideoUploadPanel.jsx";
import AnalysisResultsView from "./AnalysisResultsView.jsx";
import AIChatPanel from "./AIChatPanel.jsx";

export default function AIAnalysisTab({ onOpenAuthModal }) {
  const { data: trend, isLoading: trendLoading } = useAsyncData(getAccuracyErrorTrend, []);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeAnalysis, setActiveAnalysis] = useState(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  async function fetchSessions() {
    setSessionsLoading(true);
    try {
      const data = await getBackendSessions();
      if (Array.isArray(data) && data.length > 0) {
        setSessions(data);
      } else {
        // Fallback default mock sessions if DB is empty
        setSessions([
          { id: "an_001", date: "2026-08-19", title: "OffDrive Drill", stroke: "OffDrive", score: 88, status: "complete" },
          { id: "an_002", date: "2026-08-18", title: "Cover Drive Session", stroke: "OffDrive", score: 79, status: "complete" },
          { id: "an_003", date: "2026-08-15", title: "Cut Shot Practice", stroke: "Cut", score: 84, status: "complete" },
        ]);
      }
    } catch (e) {
      console.warn("Failed to load sessions:", e);
    } finally {
      setSessionsLoading(false);
    }
  }

  function handleAnalysisCompleted(resultData) {
    console.log("Analysis completed:", resultData);
    setActiveAnalysis(resultData);
    fetchSessions(); // Refresh history
  }

  async function handleSelectSession(sessionId) {
    const selected = sessions.find((s) => s.id === sessionId || s._id === sessionId);

    // Attempt fetching fresh full session doc from backend
    const sId = selected?._id || selected?.id || sessionId;
    let fullSession = null;
    if (sId && sId.length > 10) {
      fullSession = await getAnalysisSessionById(sId);
    }

    const source = fullSession || selected;

    if (source && (source.stroke || source.prediction)) {
      const strokeVal = source.prediction?.stroke || source.stroke;
      if (source.status === 'failed' || strokeVal === 'Processing...') {
        console.warn("Session is still processing or has failed, cannot display as completed analysis.");
        return;
      }
      setActiveAnalysis({
        prediction: source.prediction || {
          stroke: source.stroke,
          confidence: source.confidence || 0.88,
          confidence_breakdown: source.confidenceBreakdown || { [source.stroke]: source.confidence || 0.88 }
        },
        scores: source.scores || { overall: source.score || 85, head: 85, shoulder: 80, elbow: 85, hand: 80, hip: 82, feet: 84, balance: 85, follow_through: 88 },
        body_analysis: source.bodyAnalysis || source.body_analysis || {},
        feedback: source.feedback || [],
        coaching_text: source.coachingText || source.coaching_text || "Focus on lead elbow alignment and head stability over the ball.",
        video_metadata: source.videoMetadata || source.video_metadata || {},
        pdf_filename: source.pdfFilename || source.pdf_filename || "",
        pdfDownloadUrl: source.pdfDownloadUrl || "",
        visualizations: source.visualizations || {},
        videoUrl: source.videoUrl || source.video_url || ""
      });
    }
  }


  return (
    <div className="stack">
      {/* Upload Panel */}
      <VideoUploadPanel
        onAnalysisComplete={handleAnalysisCompleted}
        onOpenAuthModal={onOpenAuthModal}
      />

      {/* Main Results Dashboard if active analysis present */}
      {activeAnalysis ? (
        <AnalysisResultsView
          analysisData={activeAnalysis}
          onReset={() => setActiveAnalysis(null)}
        />
      ) : (
        <div className="grid-2">
          <Card eyebrow="Performance trend" title="Accuracy vs. error rate">
            {trendLoading ? <LoadingBlock label="Loading trend data…" /> : <AccuracyErrorChart data={trend} />}
          </Card>

          <Card eyebrow="Recent sessions" title="Analysis history">
            <SessionList
              sessions={sessions || []}
              isLoading={sessionsLoading}
              onSelect={handleSelectSession}
            />
          </Card>
        </div>
      )}

      {/* AI Assistant Chat */}
      <AIChatPanel analysis={activeAnalysis} />
    </div>
  );
}
