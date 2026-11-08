const express = require('express');
const router = express.Router();
const { chatWithAI } = require('../controllers/chatController.js');
const { requireAthlete } = require('../middleware/authMiddleware.js');

router.post('/', requireAthlete, chatWithAI);

module.exports = router;