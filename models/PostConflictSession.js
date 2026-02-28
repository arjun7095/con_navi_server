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
    default: 'draft',              // Default on creation
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
  lastUpdatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

// FIXED Pre-save hook
postConflictSessionSchema.pre('save', function (next) {
  this.lastUpdatedAt = new Date();

  // IMPORTANT: On NEW documents (creation), do NOT override status
  // Respect whatever was explicitly set (or default 'draft')
  if (this.isNew) {
    // Optionally force 'draft' if nothing was set
    if (!this.status) {
      this.status = 'draft';
    }
    return;
  }

  // On UPDATES only — check step completion
  const hasAnyStep = this.step1 || this.step2 || this.step3;
  const hasAllSteps = this.step1 && this.step2 && this.step3 && this.step4;

  if (hasAllSteps) {
    this.status = 'completed';
    this.completedAt = new Date();

    // Optional: calculate conflict time if not already set
    if (this.startedAt && !this.conflictTime) {
      this.conflictTime = Math.round((this.completedAt - this.startedAt) / (1000 * 60)); // minutes
    }
  } else if (hasAnyStep) {
    this.status = 'in_progress';
  } else {
    this.status = 'draft';
  }
});

module.exports = mongoose.model('PostConflictSession', postConflictSessionSchema);