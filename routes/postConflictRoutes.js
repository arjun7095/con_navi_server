const express = require('express');
const router = express.Router();
const postConflictController = require('../controllers/postConflictController');
const protect = require('../middleware/auth');  // protect all

router.use(protect);

router.post('/', postConflictController.createSession);

router.put('/:sessionId/step1', postConflictController.updateStep1);

// NEW STEP 2
router.put('/:sessionId/step2', postConflictController.updateStep2Feelings);

// OLD STEP2 → STEP3
router.put('/:sessionId/step3', postConflictController.updateStep3Reflection);

// OLD STEP3 → STEP4
router.put('/:sessionId/step4', postConflictController.updateStep4Rating);

// COMPLETE → STEP5
router.put('/:sessionId/complete', postConflictController.completeSession);

router.get('/:sessionId', postConflictController.getSessions);
router.get('/:sessionId/resume', postConflictController.resumeSession);
router.get('/', postConflictController.getUserSessions);

module.exports = router;