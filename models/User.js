const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
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
      match: /^[0-9]{10,15}$/,
    },

    role: {
      type: String,
      enum: ['user', 'admin', 'moderator'],
      default: 'user',
    },

    name: { type: String, trim: true },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },

    avatar: {
      type: String,
      default:
        'https://img.freepik.com/free-vector/user-circles-set_78370-4704.jpg',
    },

    profileImageUrl: {
      type: String,
      default:
        'https://img.freepik.com/free-vector/user-circles-set_78370-4704.jpg',
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

    fcmTokens: {
      type: [String],
      default: [],
    },

    refreshTokens: [
      {
        token: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true },
        deviceInfo: { type: String },
      },
    ],

    lastLogin: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);