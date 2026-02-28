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
    reflections: [{ type: String }],
  },
  step3: {
    rating: { type: Number, min: 1, max: 10 },
    category: { type: String },
    feedbackMessage: { type: String },
  },
  step4: {
    summary: { type: String },
  },
  conflictTime: { type: Number },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  lastUpdatedAt: { type: Date, default: Date.now },  // ← NEW: track last activity
  createdAt: { type: Date, default: Date.now },
});

// Pre-save hook to update status and lastUpdatedAt
postConflictSessionSchema.pre('save', function(next) {
  this.lastUpdatedAt = new Date();
  if (this.step1 && this.step2 && this.step3 && this.step4) {
    this.status = 'completed';
  } else if (this.step1 || this.step2 || this.step3) {
    this.status = 'in_progress';
  }
  
});

module.exports = mongoose.model('PostConflictSession', postConflictSessionSchema);