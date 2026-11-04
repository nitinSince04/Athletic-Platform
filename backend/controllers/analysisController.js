const path = require('path');
const mongoose = require('mongoose');
const Analysis = require('../models/Analysis.js');

const ML_SERVICE_URL = (process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');

/**
 * Sends Cloudinary video URL to Python ML service for analysis,
 * saves the result to MongoDB, and returns JSON payload.
 */
const runAnalysis = async (req, res) => {
  let initialDoc = null;
  try {
    const { videoUrl, publicId } = req.body;
    const userId = req.user ? req.user._id : null;

    if (!videoUrl) {
      return res.status(400).json({ success: false, message: 'videoUrl is required.' });
    }

    console.log(`[Backend API] Requesting ML service analysis for video URL: ${videoUrl}`);

    // Prevent duplicate submissions: check if user already has an active analysis running for this video within 2 minutes
    if (mongoose.connection.readyState === 1 && userId && mongoose.Types.ObjectId.isValid(userId)) {
      try {
        const activeJob = await Analysis.findOne({
          user: userId,
          videoUrl: videoUrl,
          status: 'processing',
          createdAt: { $gte: new Date(Date.now() - 120000) },
        });
        if (activeJob) {
          return res.status(429).json({
            success: false,
            message: 'An analysis is already in progress for this video. Please wait a moment.',
          });
        }
      } catch (dupErr) {
        console.warn('[Backend API] Duplicate check error:', dupErr.message);
      }
    }

    // Create an initial processing record in MongoDB for live Admin statistics
    if (mongoose.connection.readyState === 1 && userId && mongoose.Types.ObjectId.isValid(userId)) {
      try {
        initialDoc = await Analysis.create({
          user: userId,
          videoUrl: videoUrl,
          cloudinaryPublicId: publicId || '',
          stroke: 'Processing...',
          confidence: 0,
          status: 'processing',
        });
      } catch (docErr) {
        console.warn('[Backend API] Could not create initial processing doc:', docErr.message);
      }
    }

    // Call Python FastAPI ML Service with timeout (configurable ML_TIMEOUT_MS, default 180s)
    const controller = new AbortController();
    const timeoutMs = parseInt(process.env.ML_TIMEOUT_MS || '180000', 10);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let mlResponse;
    try {
      mlResponse = await fetch(`${ML_SERVICE_URL}/api/ml/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_url: videoUrl,
          user_id: userId ? userId.toString() : null,
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (initialDoc) {
        initialDoc.status = 'failed';
        await initialDoc.save().catch(() => {});
      }
      if (fetchErr.name === 'AbortError') {
        return res.status(504).json({
          success: false,
          message: `The AI analysis service timed out after ${timeoutMs / 1000} seconds. Please try a shorter video clip.`,
        });
      }
      return res.status(502).json({
        success: false,
        message: `Unable to reach the AI analysis engine (${ML_SERVICE_URL}). The service may be starting up on Render. Please wait 30 seconds and try again.`,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!mlResponse.ok) {
      if (initialDoc) {
        initialDoc.status = 'failed';
        await initialDoc.save().catch(() => {});
      }

      let errDetail = '';
      try {
        const errJson = await mlResponse.json();
        errDetail = errJson.detail || errJson.message || '';
      } catch {
        errDetail = await mlResponse.text().catch(() => '');
      }

      if (mlResponse.status === 429) {
        return res.status(429).json({
          success: false,
          message: errDetail || 'The AI analysis engine is currently processing at capacity. Please wait a moment and try again.',
        });
      }
      if (mlResponse.status === 503) {
        return res.status(503).json({
          success: false,
          message: errDetail || 'The AI analysis engine is temporarily unavailable. Please retry shortly.',
        });
      }

      const statusCode = mlResponse.status >= 400 && mlResponse.status < 600 ? mlResponse.status : 500;
      return res.status(statusCode).json({
        success: false,
        message: errDetail || `ML Service responded with status ${mlResponse.status}`,
      });
    }

    const mlResponseJson = await mlResponse.json();
    let mlResult = mlResponseJson;

    // Handle asynchronous job from ML service by polling until complete
    if (mlResponseJson && mlResponseJson.job_id && (mlResponseJson.status === 'processing' || !mlResponseJson.prediction)) {
      const jobId = mlResponseJson.job_id;
      console.log(`[Backend API] ML service accepted async job ${jobId}. Polling for completion...`);

      const pollStartTime = Date.now();
      const maxPollMs = Math.min(timeoutMs, 180000);
      let jobFinished = false;

      while (!jobFinished && Date.now() - pollStartTime < maxPollMs) {
        await new Promise((resolve) => setTimeout(resolve, 1500));

        try {
          const pollRes = await fetch(`${ML_SERVICE_URL}/api/ml/jobs/${jobId}`);
          if (pollRes.ok) {
            const pollData = await pollRes.json();
            if (pollData.status === 'completed') {
              mlResult = pollData.result || pollData.data || pollData;
              jobFinished = true;
              console.log(`[Backend API] ML async job ${jobId} completed successfully.`);
              break;
            } else if (pollData.status === 'failed') {
              const failureReason = pollData.error || pollData.message || 'ML analysis pipeline reported failure.';
              throw new Error(failureReason);
            }
          }
        } catch (pollErr) {
          if (pollErr.message && (pollErr.message.includes('failure') || pollErr.message.includes('failed'))) {
            throw pollErr;
          }
          console.warn(`[Backend API] Transient poll error for job ${jobId}:`, pollErr.message);
        }
      }

      if (!jobFinished) {
        throw new Error(`ML analysis job timed out on service after ${maxPollMs / 1000} seconds.`);
      }
    }

    // Strict validation: Reject empty or invalid predictions
    const strokePrediction = mlResult?.prediction?.stroke || mlResult?.prediction?.predicted_stroke;
    if (!strokePrediction || strokePrediction === 'Unknown' || !mlResult.prediction || typeof mlResult.prediction.confidence !== 'number' || mlResult.prediction.confidence <= 0) {
      if (initialDoc) {
        initialDoc.status = 'failed';
        await initialDoc.save().catch(() => {});
      }
      return res.status(502).json({
        success: false,
        message: 'ML analysis failed: Stroke classification returned an empty, unknown or invalid prediction.',
      });
    }

    if (!mlResult.scores || typeof mlResult.scores.overall !== 'number') {
      if (initialDoc) {
        initialDoc.status = 'failed';
        await initialDoc.save().catch(() => {});
      }
      return res.status(502).json({
        success: false,
        message: 'ML analysis failed: Technical performance scores are missing.',
      });
    }

    // Construct visualization URLs from ML service output filenames
    const vizData = mlResult.visualizations || {};
    const formattedVisualizations = {
      landmarkTrajectory: vizData.landmarkTrajectory ? `${ML_SERVICE_URL}/api/ml/visualizations/${vizData.landmarkTrajectory}` : '',
      jointAngles: vizData.jointAngles ? `${ML_SERVICE_URL}/api/ml/visualizations/${vizData.jointAngles}` : '',
      stability: vizData.stability ? `${ML_SERVICE_URL}/api/ml/visualizations/${vizData.stability}` : '',
      scoreBreakdown: vizData.scoreBreakdown ? `${ML_SERVICE_URL}/api/ml/visualizations/${vizData.scoreBreakdown}` : '',
      predictionConfidence: vizData.predictionConfidence ? `${ML_SERVICE_URL}/api/ml/visualizations/${vizData.predictionConfidence}` : '',
    };
    mlResult.visualizations = formattedVisualizations;
    mlResult.videoUrl = videoUrl;

    // Update initial doc or create completed record in MongoDB
    let savedRecord = initialDoc;
    if (mongoose.connection.readyState === 1 && userId && mongoose.Types.ObjectId.isValid(userId)) {
      try {
        if (savedRecord) {
          savedRecord.stroke = strokePrediction;
          savedRecord.confidence = mlResult.prediction.confidence;
          savedRecord.confidenceBreakdown = mlResult.prediction.confidence_breakdown || {};
          savedRecord.scores = mlResult.scores || {};
          savedRecord.bodyAnalysis = mlResult.body_analysis || {};
          savedRecord.feedback = mlResult.feedback || [];
          savedRecord.coachingText = mlResult.coaching_text || '';
          savedRecord.videoMetadata = mlResult.video_metadata || {};
          savedRecord.pdfFilename = mlResult.pdf_filename || '';
          savedRecord.pdfDownloadUrl = mlResult.pdf_download_url || '';
          savedRecord.visualizations = formattedVisualizations;
          savedRecord.status = 'completed';
          await savedRecord.save();
        } else {
          const analysisDoc = new Analysis({
            user: userId,
            videoUrl: videoUrl,
            cloudinaryPublicId: publicId || '',
            stroke: strokePrediction,
            confidence: mlResult.prediction.confidence,
            confidenceBreakdown: mlResult.prediction.confidence_breakdown || {},
            scores: mlResult.scores || {},
            bodyAnalysis: mlResult.body_analysis || {},
            feedback: mlResult.feedback || [],
            coachingText: mlResult.coaching_text || '',
            videoMetadata: mlResult.video_metadata || {},
            pdfFilename: mlResult.pdf_filename || '',
            pdfDownloadUrl: mlResult.pdf_download_url || '',
            visualizations: formattedVisualizations,
            status: 'completed',
          });
          savedRecord = await analysisDoc.save();
        }
      } catch (dbErr) {
        console.warn('[Backend API] Failed to save analysis to MongoDB:', dbErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      analysisId: savedRecord ? savedRecord._id : null,
      data: mlResult,
    });
  } catch (error) {
    if (initialDoc) {
      initialDoc.status = 'failed';
      await initialDoc.save().catch(() => {});
    }
    console.error('[Backend API] Analysis error:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to complete video ML analysis.',
    });
  }
};


/**
 * Get analysis history ONLY for current logged in athlete (Ownership isolation)
 */
const getMyAnalyses = async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1 && req.user && mongoose.Types.ObjectId.isValid(req.user._id)) {
      const query = { user: req.user._id };
      const sessions = await Analysis.find(query).sort({ createdAt: -1 }).limit(50);
      return res.status(200).json({ success: true, data: sessions });
    }
    return res.status(200).json({ success: true, data: [] });
  } catch (error) {
    console.error('Error fetching analysis history:', error.message);
    return res.status(200).json({ success: true, data: [] });
  }
};

/**
 * Get single analysis session by ID with ownership verification
 */
const getAnalysisById = async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(req.params.id)) {
      const analysis = await Analysis.findById(req.params.id);
      if (!analysis) {
        return res.status(404).json({ success: false, message: 'Analysis session not found.' });
      }

      if (req.user && analysis.user && analysis.user.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view your own analysis records.',
        });
      }

      return res.status(200).json({ success: true, data: analysis });
    }
    return res.status(404).json({ success: false, message: 'Analysis session not found.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error retrieving analysis session.' });
  }
};

/**
 * PDF download route with ownership check
 */
const getAnalysisPdf = async (req, res) => {
  try {
    let pdfFilename = req.params.id;

    if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(req.params.id)) {
      const analysis = await Analysis.findById(req.params.id);
      if (analysis) {
        if (req.user && analysis.user && analysis.user.toString() !== req.user._id.toString()) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You can only download your own analysis PDF reports.',
          });
        }
        if (analysis.pdfFilename) {
          pdfFilename = analysis.pdfFilename;
        }
      }
    }

    // Proxy PDF fetch from Python ML FastAPI Service
    const pdfRes = await fetch(`${ML_SERVICE_URL}/api/ml/pdf/${pdfFilename}`);
    if (!pdfRes.ok) {
      return res.status(404).json({ success: false, message: 'PDF report file missing on ML service.' });
    }

    const arrayBuffer = await pdfRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}"`);
    return res.send(buffer);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error generating PDF report download.' });
  }
};

/**
 * Visualization chart image proxy route
 */
const getAnalysisVisualization = async (req, res) => {
  try {
    const filename = path.basename(req.params.filename || '');
    if (!filename) {
      return res.status(400).json({ success: false, message: 'Filename required.' });
    }
    const chartRes = await fetch(`${ML_SERVICE_URL}/api/ml/visualizations/${filename}`);
    if (!chartRes.ok) {
      return res.status(404).json({ success: false, message: 'Visualization not found.' });
    }
    const arrayBuffer = await chartRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.setHeader('Content-Type', 'image/png');
    return res.send(buffer);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error retrieving visualization image.' });
  }
};

module.exports = {
  runAnalysis,
  getMyAnalyses,
  getAnalysisHistory: getMyAnalyses,
  getAnalysisById,
  getAnalysisPdf,
  getAnalysisVisualization,
};
