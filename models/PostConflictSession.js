const mongoose = require('mongoose');
const { CONFLICT_SESSION_STATUS } = require('../utils/conflictSessionStatus');

const postConflictSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  status: {
    type: String,
    enum: Object.values(CONFLICT_SESSION_STATUS),
    default: CONFLICT_SESSION_STATUS.ACTIVE,
  },

  // STEP 1 (unchanged)
  step1: {
    rating: { type: Number, min: 1, max: 10 },
    category: { type: String },
  },

  // ✅ NEW STEP 2 (feelings)
  step2: {
    presentFeelings: [{ type: String, trim: true }],
    desiredFeelings: [{ type: String, trim: true }],
  },

  // ✅ OLD STEP 2 → NOW STEP 3
  step3: {
    experience:    { type: String, trim: true },
    react:         { type: String, trim: true },
    assumption:    { type: String, trim: true },
    thoughts:      { type: String, trim: true },
    understanding: { type: String, trim: true },

    terms: [{
      option:      { type: String, required: true, trim: true },
      description: { type: String, required: true, trim: true },
    }],
  },

  // ✅ OLD STEP 3 → NOW STEP 4
  step4: {
    rating: { type: Number, min: 1, max: 10 },
    category: { type: String },
    feedbackMessage: { type: String },
  },

  // ✅ OLD STEP 4 → NOW STEP 5
  step5: {
    status: { type: String },
  },

  conflictTime: { type: Number },
  startedAt: { type: Date, default: Date.now },
  pausedAt: { type: Date },
  resumedAt: { type: Date },
  completedAt: { type: Date },
  lastUpdatedAt: { type: Date, default: Date.now },
  interruptionReminder: {
    isActive: { type: Boolean, default: false },
    interruptedAt: { type: Date, default: null },
    lastSentAt: { type: Date, default: null },
    quickReminderCount: { type: Number, default: 0 },
    totalReminderCount: { type: Number, default: 0 },
    nextReminderAt: { type: Date, default: null },
  },
  createdAt: { type: Date, default: Date.now },

}, { strict: false, timestamps: true });

postConflictSessionSchema.pre('save', function () {
  this.lastUpdatedAt = new Date();
});

module.exports = mongoose.model('PostConflictSession', postConflictSessionSchema);
