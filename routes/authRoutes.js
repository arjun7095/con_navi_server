const express = require('express');
const router = express.Router();
const { sendOTP, verifyOTP, createProfile, updateProfile } = require('../controllers/authController');
const protect = require('../middleware/auth');

router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);

router.post('/create-profile', protect, createProfile);
router.put('/profile', protect, updateProfile); // or /edit-profile

module.exports = router;