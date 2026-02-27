const express = require('express');
const router = express.Router();
const {
  createLiveSession,
  updateStep,
  pauseSession,
  resumeSession,
  getUserSessions,
  getSession,
  completeSession,
} = require('../controllers/liveConflictController');

const protect = require('../middleware/auth');

// All routes protected
router.use(protect);

// Start new live conflict session
router.post('/', createLiveSession);

// Update any step (generic endpoint – handles step 1 through 12)
router.put('/:sessionId/step/:stepNumber', updateStep);

// Pause session (any step)
router.post('/:sessionId/pause', pauseSession);

// Resume paused session
router.post('/:sessionId/resume', resumeSession);

// Get all user's live sessions (history)
router.get('/', getUserSessions);

// Get single session details (for resumption/view)
router.get('/:sessionId', getSession);

// Manually complete (step 12 or admin force)
router.put('/:sessionId/complete', completeSession);

module.exports = router;    