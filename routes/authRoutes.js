const express = require('express');
const router = express.Router();
const { verifyPhoneAndRole, createProfile, updateProfile } = require('../controllers/authController');
const protect = require('../middleware/auth');

router.post('/verify-phone', verifyPhoneAndRole);

router.post('/create-profile', protect, createProfile);
router.put('/profile', protect, updateProfile); // or /edit-profile

module.exports = router;