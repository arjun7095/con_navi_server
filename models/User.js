const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    required: true,
    unique: true,
    sparse: true,           // allows null if you keep old users during migration
  },
  countryCode: {
    type: String,
    required: true,
    trim: true,
  },
  mobile: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'moderator'],
    default: 'user',
  },
  name:          { type: String, trim: true },
  email:         { type: String, trim: true, lowercase: true },
  avatar: {
    type: String,
    default: 'https://img.freepik.com/free-vector/user-circles-set_78370-4704.jpg',
  },
  profileImageUrl: {
    type: String,
    default: 'https://img.freepik.com/free-vector/user-circles-set_78370-4704.jpg',
  },
  notificationPreference: {
    type: String,
    enum: ['all', 'important', 'none'],
    default: 'all',
  },
  dataAnalyticsEnabled: {
    type: Boolean,
    default: true,
  },
  isProfileComplete: {
    type: Boolean,
    default: false,
  },
  fcmTokens: [String],              // ← NEW: for push notifications

  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date },
});

module.exports = mongoose.model('User', userSchema);