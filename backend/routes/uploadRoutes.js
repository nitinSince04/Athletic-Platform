const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');
const path = require('path');
const { uploadVideoToCloudinary } = require('../controllers/uploadController.js');
const { requireAthlete } = require('../middleware/authMiddleware.js');

const maxVideoSizeMB = parseInt(process.env.MAX_VIDEO_SIZE_MB || '150', 10);

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: maxVideoSizeMB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/avi',
      'video/webm',
      'video/mkv',
      'video/x-matroska',
    ];
    const allowedExts = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isMimeValid = file.mimetype && (file.mimetype.startsWith('video/') || allowedMimes.includes(file.mimetype.toLowerCase()));
    const isExtValid = allowedExts.includes(ext);

    if (isMimeValid || isExtValid) {
      return cb(null, true);
    }
    return cb(
      new Error(`Unsupported video format. Allowed formats: MP4, MOV, AVI, WEBM, MKV. Received: ${file.mimetype || ext}`)
    );
  },
});

// Middleware wrapper to catch Multer errors gracefully with HTTP 400
const handleUploadMiddleware = (req, res, next) => {
  upload.single('video')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: `File size exceeds the ${maxVideoSizeMB}MB limit. Please upload a shorter cricket clip.`,
        });
      }
      return res.status(400).json({
        success: false,
        message: `Upload error: ${err.message}`,
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }
    next();
  });
};

// Protect video upload endpoint with requireAthlete middleware
router.post('/video', requireAthlete, handleUploadMiddleware, uploadVideoToCloudinary);

module.exports = router;
