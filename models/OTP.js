// models/OTP.js
const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  countryCode: String,
  mobile: String,
  role: { type: String, enum: ['user', 'admin'] },
  otp: String,
  expiresAt: { type: Date, default: () => Date.now() + 2 * 60 * 1000 }, // 2 min
});

module.exports = mongoose.model('OTP', otpSchema);