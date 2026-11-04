const { cloudinary, configureCloudinary } = require('../config/cloudinary.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Handle video upload to Cloudinary or Local Uploads Directory.
 * Accepts multipart file upload and saves each file uniquely to ensure ML pipeline gets real unique video content.
 */
const uploadVideoToCloudinary = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No video file provided.' });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname || 'video.mp4';
    const fileExt = path.extname(originalName) || '.mp4';

    // Ensure Cloudinary configuration is loaded
    configureCloudinary();

    const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
    const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
    const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();

    const isCloudinaryConfigured =
      (process.env.CLOUDINARY_URL || (cloudName && apiKey && apiSecret)) &&
      cloudName !== 'demo' &&
      apiKey !== '123456789012345';

    if (!isCloudinaryConfigured) {
      if (process.env.NODE_ENV === 'production') {
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return res.status(503).json({
          success: false,
          message: 'Cloudinary storage is required in production but is not configured. Please verify Cloudinary environment variables.',
        });
      }

      console.log('[Upload Controller] Cloudinary not configured in local environment. Storing video in local uploads directory for development.');
      
      const uploadsDir = path.join(__dirname, '../uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const uniqueFilename = `video_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${fileExt}`;
      const destPath = path.join(uploadsDir, uniqueFilename);

      // Copy uploaded file to uploads directory
      fs.copyFileSync(filePath, destPath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      const host = req.get('host') || '127.0.0.1:5000';
      const protocol = req.protocol || 'http';
      const localUrl = `${protocol}://${host}/uploads/${uniqueFilename}`;

      console.log(`[Upload Controller] Local video upload ready: ${localUrl} (${destPath})`);

      return res.status(200).json({
        success: true,
        secure_url: localUrl,
        public_id: `local_${uniqueFilename}`,
        resource_type: 'video',
        duration: 15.0,
        message: 'Video saved to local uploads storage',
      });
    }

    try {
      // Attempt real Cloudinary upload
      const result = await cloudinary.uploader.upload(filePath, {
        resource_type: 'video',
        folder: 'cricket_ai_videos',
        overwrite: false,
        public_id: `cricket_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      });

      return res.status(200).json({
        success: true,
        secure_url: result.secure_url,
        public_id: result.public_id,
        resource_type: result.resource_type,
        duration: result.duration,
      });
    } catch (cloudinaryError) {
      console.error("Cloudinary upload error details:", {
        message: cloudinaryError.message,
        http_code: cloudinaryError.http_code,
        name: cloudinaryError.name
      });
      return res.status(400).json({
        success: false,
        message: `Cloudinary upload failed: ${cloudinaryError.message}`,
        error: cloudinaryError.message,
      });
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (cleanupErr) {
          console.warn('[Upload Controller] Could not delete temp file:', cleanupErr.message);
        }
      }
    }
  } catch (error) {
    console.error('Upload Controller error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload video.',
    });
  }
};


module.exports = { uploadVideoToCloudinary };
