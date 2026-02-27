const express = require('express');
const router = express.Router();
const postConflictController = require('../controllers/postConflictController');
const protect = require('../middleware/auth');  // protect all

router.use(protect);

router.post('/sessions', postConflictController.createSession);
router.put('/sessions/:sessionId/step1', postConflictController.updateStep1);
router.put('/sessions/:sessionId/step2', postConflictController.updateStep2);
router.put('/sessions/:sessionId/step3', postConflictController.updateStep3);
router.put('/sessions/:sessionId/complete', postConflictController.completeSession);
router.get('/sessions', postConflictController.getSessions);
router.get('/sessions/:sessionId', postConflictController.getSession);
router.get('/sessions/:sessionId/resume', postConflictController.resumeSession);

module.exports = router;