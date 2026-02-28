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
    // any extra fields (str1, str2, note, priority, etc.) are allowed dynamically
    terms: [{
      option:      { type: String, required: true, trim: true },
      description: { type: String, required: true, trim: true },
      // No other fields defined → MongoDB accepts anything extra
    }],
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

// Pre-save hook – only complete after step4 is filled
postConflictSessionSchema.pre('save', function () {
  this.lastUpdatedAt = new Date();

  // On new documents → skip status override
  if (this.isNew) {
    return;
  }

  // On updates only
  const hasAnyStep = this.step1 || this.step2 || this.step3;
  const hasAllSteps = this.step1 && this.step2 && this.step3 && this.step4;

  if (hasAllSteps) {
    this.status = 'completed';
    this.completedAt = new Date();

    if (this.startedAt && !this.conflictTime) {
      this.conflictTime = Math.round((this.completedAt - this.startedAt) / (1000 * 60));
    }
  } else if (hasAnyStep) {
    this.status = 'in_progress';
  } else {
    this.status = 'draft';
  }

  // No next() — modern Mongoose handles it
});

module.exports = mongoose.model('PostConflictSession', postConflictSessionSchema);