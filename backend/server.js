const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');


// Load environment variables reliably from workspace root, parent, and local backend .env files
// Priority: Root -> Parent -> Local Backend (.env in backend directory takes highest precedence with override: true)
const envPaths = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, './.env')
];
envPaths.forEach(envPath => {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
});

const connectDB = require('./config/db.js');
const seedAdmin = require('./config/seedAdmin.js');
const { configureCloudinary } = require('./config/cloudinary.js');

const authRoutes = require('./routes/authRoutes.js');
const uploadRoutes = require('./routes/uploadRoutes.js');
const analysisRoutes = require('./routes/analysisRoutes.js');
const adminRoutes = require('./routes/adminRoutes.js');
const reportRoutes = require('./routes/reportRoutes.js');
const coachRoutes = require('./routes/coachRoutes.js');
const athleteRoutes = require('./routes/athleteRoutes.js');
const chatRoutes = require('./routes/chatRoutes.js');
const publicRoutes = require('./routes/publicRoutes.js');

const app = express();

const startServer = async () => {
  try {
    await connectDB();
    await seedAdmin();
    configureCloudinary();

    // Middleware
    app.use(cors());
    app.use(express.json());

    // Serve local video uploads directory statically if present
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    app.use('/uploads', express.static(uploadsDir));

    // Routes
    app.use('/api/public', publicRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/upload', uploadRoutes);
    app.use('/api/analysis', analysisRoutes);
    app.use('/api/admin', adminRoutes);
    app.use('/api/reports', reportRoutes);
    app.use('/api/coach', coachRoutes);
    app.use('/api/athlete', athleteRoutes);
    app.use('/api/chat', chatRoutes);


    // Basic test route
    app.get('/', (req, res) => {
      res.send('Sports Management API & Cricket AI Pipeline running...');
    });

    // 404 Handler
    app.use((req, res, next) => {
      res.status(404).json({ success: false, message: `Route not found - ${req.originalUrl}` });
    });

    // Global Error Handler
    app.use((err, req, res, next) => {
      console.error('Unhandled Error:', err.stack);
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Internal Server Error',
      });
    });

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`Node.js Express Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

// Invoke start
startServer();
