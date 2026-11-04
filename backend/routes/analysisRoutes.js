const express = require('express');
const router = express.Router();
const {
  runAnalysis,
  getMyAnalyses,
  getAnalysisById,
  getAnalysisPdf,
  getAnalysisVisualization,
} = require('../controllers/analysisController.js');
const { requireAthlete } = require('../middleware/authMiddleware.js');

// Public or proxied visualization serving
router.get('/visualizations/:filename', getAnalysisVisualization);

// Strictly enforce requireAthlete on EVERY video-analysis endpoint
router.post('/upload', requireAthlete, runAnalysis);
router.post('/analyze', requireAthlete, runAnalysis);
router.get('/my', requireAthlete, getMyAnalyses);
router.get('/sessions', requireAthlete, getMyAnalyses);
router.get('/sessions/:id', requireAthlete, getAnalysisById);
router.get('/:id', requireAthlete, getAnalysisById);
router.get('/:id/report', requireAthlete, getAnalysisById);
router.get('/:id/pdf', requireAthlete, getAnalysisPdf);

module.exports = router;
