const mongoose = require('mongoose');

const postConflictSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  status: {
    type: String,
    enum: ['draft', 'in_progress', 'completed'],
    default: 'draft',
  },
  step1: {
    rating: { type: Number, min: 1, max: 10 },
    category: { type: String },
  },
  step2: {
    experience:    { type: String, trim: true },
    react:         { type: String, trim: true },
    assumption:    { type: String, trim: true },
    thoughts:      { type: String, trim: true },
    understanding: { type: String, trim: true },

    // terms array: only option and description are enforced
    // extra fields (reason1, str1, str2, etc.) are stored dynamically
    terms: [{
      option:      { type: String, required: true, trim: true },
      description: { type: String, required: true, trim: true },
      // NO other fields defined here → MongoDB stores everything extra automatically
    }],
  },
  step3: {
    rating: { type: Number, min: 1, max: 10 },
    category: { type: String },
    feedbackMessage: { type: String },
  },
  step4: {
    status: { type: String },
  },
  conflictTime: { type: Number },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  lastUpdatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
}, { strict: false, timestamps: true });

// Pre-save hook – unchanged (only updates timestamp)
postConflictSessionSchema.pre('save', function () {
  this.lastUpdatedAt = new Date();
  // No next() – modern Mongoose handles it
});

module.exports = mongoose.model('PostConflictSession', postConflictSessionSchema);