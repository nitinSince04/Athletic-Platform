const RAW_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');
const API_BASE_URL = RAW_URL.endsWith('/api') ? RAW_URL : `${RAW_URL}/api`;
const ML_SERVICE_URL = (import.meta.env.VITE_ML_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');

function getAuthHeaders(isJson = true) {
  const token = localStorage.getItem('authToken');
  const headers = {};
  if (isJson) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Uploads a local video file to Cloudinary via backend.
 * Protected by requireAthlete backend middleware.
 */
export async function uploadVideoToCloudinary(file) {
  const formData = new FormData();
  formData.append('video', file);

  const token = localStorage.getItem('authToken');
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/upload/video`, {
      method: 'POST',
      headers,
      body: formData,
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const errMsg = (json && json.message) || `Upload failed with status ${res.status}`;
      throw new Error(errMsg);
    }

    return json;
  } catch (error) {
    console.error('uploadVideoToCloudinary error:', error);
    throw error;
  }
}

/**
 * Sends Cloudinary secure URL to backend analysis API (which calls ML service).
 * Protected by requireAthlete backend middleware.
 */
export async function triggerCricketMLAnalysis(videoUrl, publicId) {
  try {
    const res = await fetch(`${API_BASE_URL}/analysis/analyze`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ videoUrl, publicId }),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const errMsg = (json && json.message) || `Analysis failed with status ${res.status}`;
      const err = new Error(errMsg);
      err.status = res.status;
      throw err;
    }

    let finalData = json?.data || json;
    const analysisId = json?.analysisId || finalData?.analysisId;

    // If analysis is in progress, poll the session endpoint until completed
    if (finalData && (finalData.status === 'processing' || !finalData.prediction) && analysisId) {
      const startTime = Date.now();
      const maxPoll = 180000;
      while (Date.now() - startTime < maxPoll) {
        await new Promise((r) => setTimeout(r, 2000));
        const session = await getAnalysisSessionById(analysisId);
        if (session && session.status === 'completed') {
          finalData = {
            prediction: session.prediction || {
              stroke: session.stroke,
              predicted_stroke: session.stroke,
              confidence: session.confidence || 0,
              confidence_breakdown: session.confidenceBreakdown || {}
            },
            scores: session.scores || {},
            body_analysis: session.bodyAnalysis || {},
            feedback: session.feedback || [],
            coaching_text: session.coachingText || '',
            video_metadata: session.videoMetadata || {},
            pdf_filename: session.pdfFilename || '',
            pdfDownloadUrl: session.pdfDownloadUrl || '',
            visualizations: session.visualizations || {},
            videoUrl: session.videoUrl || videoUrl,
            analysisId: session._id || analysisId
          };
          break;
        } else if (session && session.status === 'failed') {
          throw new Error('Video analysis processing failed on the server.');
        }
      }
    }

    // Strict frontend validation: Ensure prediction and scores are valid
    const strokeVal = finalData?.prediction?.stroke || finalData?.prediction?.predicted_stroke || finalData?.stroke;
    if (!strokeVal || strokeVal === 'Unknown' || strokeVal === 'Processing...') {
      throw new Error("Analysis completed with an invalid or missing stroke classification. Please try again with a clearer cricket stroke clip.");
    }

    if (!finalData.scores || typeof finalData.scores.overall !== 'number') {
      throw new Error("Analysis completed but performance scores are missing.");
    }

    return {
      ...finalData,
      analysisId: analysisId || finalData._id,
    };
  } catch (error) {
    console.error('triggerCricketMLAnalysis error:', error);
    throw error;
  }
}

/**
 * Fetches user's analysis session history from backend.
 * Protected by requireAthlete backend middleware.
 */
export async function getAnalysisSessions() {
  try {
    const res = await fetch(`${API_BASE_URL}/analysis/sessions`, {
      method: 'GET',
      headers: getAuthHeaders(true),
    });

    if (res.ok) {
      const json = await res.json();
      return json.data || json;
    }
  } catch (err) {
    console.warn('Failed to fetch backend analysis sessions:', err);
  }
  return [];
}

/**
 * Fetches a single analysis session record by ID with ownership verification.
 */
export async function getAnalysisSessionById(id) {
  try {
    const res = await fetch(`${API_BASE_URL}/analysis/sessions/${id}`, {
      method: 'GET',
      headers: getAuthHeaders(true),
    });

    if (res.ok) {
      const json = await res.json();
      return json.data || json;
    }
  } catch (err) {
    console.warn(`Failed to fetch analysis session ${id}:`, err);
  }
  return null;
}


/**
 * Fetches admin statistics for Admin Dashboard
 */
export async function getAdminStatsApi() {
  try {
    const res = await fetch(`${API_BASE_URL}/admin/stats`, {
      method: 'GET',
      headers: getAuthHeaders(true),
    });
    if (res.ok) {
      const json = await res.json();
      return json.stats;
    }
  } catch (err) {
    console.warn('Failed to fetch admin stats:', err);
  }
  return null;
}

/**
 * Constructs downloadable URL for PDF report with support for both
 * authenticated backend proxy and direct ML service endpoint.
 */
export function getPdfDownloadUrl(pdfFilename, analysisId) {
  if (!pdfFilename && !analysisId) return '#';
  const token = localStorage.getItem('authToken');
  if (analysisId) {
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${API_BASE_URL}/analysis/${analysisId}/pdf${query}`;
  }
  return `${ML_SERVICE_URL}/api/ml/pdf/${pdfFilename}`;
}
