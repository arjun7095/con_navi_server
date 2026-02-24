const express = require('express');
const router = express.Router();
const {
  createSession,
  getUserSessions,
  getSessionById,
  resumeSession,
  updateSessionProgress,
  abandonSession,
  getSessionSummary,
} = require('../controllers/sessionController');

const protect = require('../middleware/auth'); // your JWT middleware

// Create new session (live or post)
router.post('/', protect, createSession);

// List all user's sessions
router.get('/', protect, getUserSessions);

// Get single session details
router.get('/:id', protect, getSessionById);

// Resume a paused / in-progress session
router.put('/:id/resume', protect, resumeSession);

// Main progress endpoint: update data, move step, pause, complete, etc.
router.put('/:id/progress', protect, updateSessionProgress);

// Mark as abandoned (user stops without completing)
router.put('/:id/abandon', protect, abandonSession);

// Get timing & summary stats
router.get('/:id/summary', protect, getSessionSummary);

module.exports = router;