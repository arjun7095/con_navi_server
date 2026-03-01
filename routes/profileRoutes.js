// routes/profileRoutes.js  (recommended to separate)
const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const {
  getProfileById,
  updateProfileById,
  deleteProfileById
} = require('../controllers/profileController');   // new controller or put in authController/userController

// ── GET profile by userId ─────────────────────────────────────
router.get('/:userId', protect, getProfileById);

// ── UPDATE profile by userId ──────────────────────────────────
router.put('/:userId', protect, updateProfileById);

// ── DELETE profile (self-delete) ──────────────────────────────
router.delete('/:userId', protect, deleteProfileById);

module.exports = router;