const express = require('express');
const router = express.Router();
const postConflictController = require('../controllers/postConflictController');
// const protect = require('../middleware/auth');  // protect all

// router.use();

router.post('/', postConflictController.createSession);
router.put('/:sessionId/step1', postConflictController.updateStep1);
router.put('/:sessionId/step2', postConflictController.updateStep2);
router.put('/:sessionId/step3', postConflictController.updateStep3);
router.put('/:sessionId/complete', postConflictController.completeSession);
router.get('/:sessionId', postConflictController.getSessions);
// router.get('/:sessionId', postConflictController.getSession);
router.get('/:sessionId/resume', postConflictController.resumeSession);

module.exports = router;