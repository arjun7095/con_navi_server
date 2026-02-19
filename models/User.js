const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    countryCode:{
        type:String,
        required:true,
        trim:true
    },
  mobile: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  name: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
  },
  // ── NEW FIELDS ────────────────────────────────────────────────
  avatar: {
    type: String,           // URL to avatar image (e.g. Cloudinary, AWS S3, or Gravatar)
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
  profileImageUrl: {
    type: String,           // Could be same as avatar or separate (e.g. full-size vs thumbnail)
    default: 'https://img.freepik.com/free-vector/user-circles-set_78370-4704.jpg',
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'moderator'],
    default: 'user',
  },
  isProfileComplete:{
    type:Boolean,
    default:false
  },
  // ──────────────────────────────────────────────────────────────

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('User', userSchema);