const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User.js');
const { inMemoryUsers } = require('../controllers/authController.js');

/**
 * Reusable middleware to authenticate JWT tokens.
 */
const authenticateUser = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.headers['x-auth-token']) {
    token = req.headers['x-auth-token'];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'fallback_secret_key'
    );


    if (mongoose.connection.readyState === 1) {
      req.user = await User.findById(decoded.id).select('-password');
    } else {
      // Fallback in-memory user lookup by decoded ID or email or payload info
      let foundUser = null;
      for (const u of inMemoryUsers.values()) {
        if (u._id === decoded.id) {
          foundUser = u;
          break;
        }
      }
      if (!foundUser) {
        // Construct user object from decoded JWT payload
        foundUser = {
          _id: decoded.id,
          name: decoded.name || 'Authenticated User',
          email: decoded.email || 'user@example.com',
          role: decoded.role || 'athlete',
        };
      }
      req.user = foundUser;
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. User no longer exists.',
      });
    }

    if (req.user.isDeleted) {
      return res.status(401).json({
        success: false,
        message: 'Account no longer active. Please contact administrator.',
      });
    }

    if (req.user.isBanned) {
      if (req.user.banType === 'temporary' && req.user.banUntil) {
        const now = new Date();
        const expireDate = new Date(req.user.banUntil);
        if (now < expireDate) {
          const formattedDate = expireDate.toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
          });
          const reasonText = req.user.banReason ? ` Reason: ${req.user.banReason}` : '';
          return res.status(403).json({
            success: false,
            message: `Your account is temporarily banned until ${formattedDate}.${reasonText}`,
          });
        } else {
          // Ban has expired! Automatically unban the user
          req.user.isBanned = false;
          req.user.banType = null;
          req.user.banUntil = null;
          req.user.banReason = '';
          if (typeof req.user.save === 'function') {
            await req.user.save();
          }
        }
      } else if (req.user.banType === 'permanent') {
        const reasonText = req.user.banReason ? ` Reason: ${req.user.banReason}` : '';
        return res.status(403).json({
          success: false,
          message: `Your account has been permanently banned.${reasonText}`,
        });
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Invalid or expired token.',
    });
  }
};

/**
 * Middleware: Strictly requires authenticated user AND user.role === "athlete".
 * - If unauthenticated -> 401 "Authentication required."
 * - If authenticated but role != athlete -> 403 "Video analysis is available only to athletes."
 */
const requireAthlete = async (req, res, next) => {
  await authenticateUser(req, res, () => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (req.user.role !== 'athlete') {
      return res.status(403).json({
        success: false,
        message: 'Video analysis is available only to athletes.',
      });
    }

    next();
  });
};

/**
 * Middleware: Strictly requires authenticated user AND user.role === "admin".
 */
const requireAdmin = async (req, res, next) => {
  await authenticateUser(req, res, () => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required.',
      });
    }

    next();
  });
};

/**
 * Middleware: Strictly requires authenticated user AND user.role === "coach".
 */
const requireCoach = async (req, res, next) => {
  await authenticateUser(req, res, () => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (String(req.user.role).toLowerCase() !== 'coach') {
      return res.status(403).json({
        success: false,
        message: 'Coach access required to perform this action.',
      });
    }

    next();
  });
};

const protect = authenticateUser;
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role '${req.user.role}' is not authorized to access this route.`,
      });
    }
    next();
  };
};

module.exports = {
  authenticateUser,
  requireAthlete,
  requireCoach,
  requireAdmin,
  protect,
  authorize,
};
