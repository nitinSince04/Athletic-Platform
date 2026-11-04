const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User.js');

// In-memory fallback user store for dev/testing when MongoDB is not active locally
const inMemoryUsers = new Map();

/**
 * Generate JWT Token containing userId and role
 */
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET || 'fallback_secret_key', {
    expiresIn: '30d',
  });
};

/**
 * @desc    Register a new user with selected role (athlete or coach)
 * @route   POST /api/auth/register
 * @access  Public
 */
const registerUser = async (req, res) => {
  try {
    const { name, email, password, role: requestedRole, battingRole, battingStyle } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password',
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Validate requested role
    let userRole = 'athlete';
    if (requestedRole) {
      const cleanRole = String(requestedRole).toLowerCase().trim();
      if (cleanRole === 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin account registration is strictly restricted.',
        });
      }
      if (['athlete', 'coach'].includes(cleanRole)) {
        userRole = cleanRole;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid role requested. Allowed roles are: athlete, coach',
        });
      }
    }

    // Check if DB is connected
    if (mongoose.connection.readyState === 1) {
      const userExists = await User.findOne({ email: cleanEmail });
      if (userExists) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email',
        });
      }

      const user = await User.create({
        name: name.trim(),
        email: cleanEmail,
        password,
        role: userRole,
        battingRole: battingRole || 'Opening Batter',
        battingStyle: battingStyle || 'Right-Handed',
      });

      const token = generateToken(user._id.toString(), user.role);

      return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        token,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          battingRole: user.battingRole,
          battingStyle: user.battingStyle,
          team: user.team,
          createdAt: user.createdAt,
        },
      });
    } else {
      // In-memory fallback mode with valid 24-character hex ObjectId
      if (inMemoryUsers.has(cleanEmail)) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email',
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const mockId = new mongoose.Types.ObjectId().toHexString();
      const mockUser = {
        _id: mockId,
        name: name.trim(),
        email: cleanEmail,
        password: hashedPassword,
        role: userRole,
        battingRole: battingRole || 'Opening Batter',
        battingStyle: battingStyle || 'Right-Handed',
        createdAt: new Date(),
      };

      inMemoryUsers.set(cleanEmail, mockUser);
      const token = generateToken(mockUser._id, mockUser.role);

      return res.status(201).json({
        success: true,
        message: 'User registered successfully (In-Memory)',
        token,
        user: {
          _id: mockUser._id,
          name: mockUser.name,
          email: mockUser.email,
          role: mockUser.role,
          battingRole: mockUser.battingRole,
          battingStyle: mockUser.battingStyle,
          createdAt: mockUser.createdAt,
        },
      });
    }
  } catch (error) {
    console.error(`Register Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Server Error during registration',
      error: error.message,
    });
  }
};


/**
 * @desc    Authenticate user & get token
 * @route   POST /api/auth/login
 * @access  Public
 */
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    if (mongoose.connection.readyState === 1) {
      const user = await User.findOne({ email: cleanEmail });
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
        });
      }

      if (user.isDeleted) {
        return res.status(401).json({
          success: false,
          message: 'Account no longer active. Please contact administrator.',
        });
      }

      // Ban verification & auto-unban expiration check
      if (user.isBanned) {
        if (user.banType === 'temporary' && user.banUntil) {
          const now = new Date();
          const expireDate = new Date(user.banUntil);
          if (now < expireDate) {
            const formattedDate = expireDate.toLocaleString('en-US', {
              dateStyle: 'medium',
              timeStyle: 'short',
            });
            const reasonText = user.banReason ? ` Reason: ${user.banReason}` : '';
            return res.status(403).json({
              success: false,
              message: `Your account is temporarily banned until ${formattedDate}.${reasonText}`,
            });
          } else {
            // Ban has expired! Automatically unban the user
            user.isBanned = false;
            user.banType = null;
            user.banUntil = null;
            user.banReason = '';
            await user.save();
          }
        } else if (user.banType === 'permanent') {
          const reasonText = user.banReason ? ` Reason: ${user.banReason}` : '';
          return res.status(403).json({
            success: false,
            message: `Your account has been permanently banned.${reasonText}`,
          });
        }
      }

      const isMatch = await user.matchPassword(password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
        });
      }

      const token = generateToken(user._id.toString(), user.role);

      return res.status(200).json({
        success: true,
        message: 'Logged in successfully',
        token,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          battingRole: user.battingRole,
          battingStyle: user.battingStyle,
          team: user.team,
          createdAt: user.createdAt,
        },
      });
    } else {
      // In-memory fallback check
      const memUser = inMemoryUsers.get(cleanEmail);
      if (!memUser) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
        });
      }

      const isMatch = await bcrypt.compare(password, memUser.password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
        });
      }

      const token = generateToken(memUser._id, memUser.role);

      return res.status(200).json({
        success: true,
        message: 'Logged in successfully',
        token,
        user: {
          _id: memUser._id,
          name: memUser.name,
          email: memUser.email,
          role: memUser.role,
          createdAt: memUser.createdAt,
        },
      });
    }
  } catch (error) {
    console.error(`Login Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Server Error during login',
      error: error.message,
    });
  }
};

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Public / Private
 */
const logoutUser = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
};

/**
 * @desc    Get current logged in user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        battingRole: req.user.battingRole,
        battingStyle: req.user.battingStyle,
        team: req.user.team,
        createdAt: req.user.createdAt,
      },
    });
  } catch (error) {
    console.error(`GetMe Error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Server Error retrieving profile',
      error: error.message,
    });
  }
};

const getDashboardRoute = (role) => {
  if (role === 'admin') return '/dashboard/admin';
  if (role === 'coach') return '/dashboard/coach';
  return '/dashboard/athlete';
};

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  getMe,
  getDashboardRoute,
  inMemoryUsers,
};

