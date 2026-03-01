const mongoose = require('mongoose');

const liveConflictSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'abandoned'],
    default: 'active',
  },

  currentStep: {
    type: Number,
    min: 1,
    max: 12,
    default: 1,
  },

  // Step 1
  initialDistress: {
    rating: { type: Number, min: 1, max: 10 },
    category: String,
  },

  // Step 2
  isBreathingExercise: {
    type: Boolean,
    default: false,
  },

  // Step 3
  presentFeelings: [{ type: String }],
  desiredFeelings: [{ type: String }],

  // Step 4 – Break option
  choseToBreak: { type: Boolean, default: false },
  breakReason: String,
  resumeAt: Date,

  // Step 5
  nonNegotiablesAgreed: { type: Boolean, default: false },

  // Steps 6–10: Conversation cycles
  conversationCycles: [{
    cycleNumber: { type: Number, required: true },

    // NEW: Selection for this cycle
    selection: { 
      type: String, 
      enum: ['speaking', 'listening', null], 
      default: null 
    },

    // NEW: Completion flags per side
    isSpeakingComplete: { type: Boolean, default: false },
    isListeningComplete: { type: Boolean, default: false },

    speaking: {
      experience: { type: String, trim: true },
      assumptions: { type: String, trim: true },
      helpStructureSelected: { type: Boolean, default: false },
      when: { type: String, trim: true },
      request: { type: String, trim: true },
      structuredStatements: [{ type: String }],
      timestamp: { type: Date, default: Date.now },
    },

    listening: {
      communicated: { type: String, trim: true },
      timestamp: { type: Date, default: Date.now },
    },

    // Cycle complete only when both flags are true
    completed: { type: Boolean, default: false },
  }],

  // Step 11
  finalDistress: {
    rating: { type: Number, min: 1, max: 10 },
    category: String,
  },

  // Step 12
  isCompleted: { type: Boolean, default: false },

  // Timestamps & duration
  startedAt: { type: Date, default: Date.now },
  pausedAt: Date,
  resumedAt: Date,
  completedAt: Date,
  totalDurationMinutes: Number,

  // Pause/resume history
  pauseHistory: [{
    pausedAt: Date,
    reason: String,
    resumedAt: Date,
  }],

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Auto-update logic (updated to use new flags)
liveConflictSchema.pre('save', function (next) {
  this.updatedAt = new Date();

  // Auto-set completed if both sides are done
  const lastCycle = this.conversationCycles[this.conversationCycles.length - 1];
  if (lastCycle) {
    if (lastCycle.isSpeakingComplete && lastCycle.isListeningComplete) {
      lastCycle.completed = true;
    }
  }

  if (this.isCompleted) {
    this.status = 'completed';
    this.completedAt = new Date();
    if (this.startedAt) {
      this.totalDurationMinutes = Math.round((this.completedAt - this.startedAt) / (1000 * 60));
    }
  }
});

module.exports = mongoose.model('LiveConflictSession', liveConflictSchema);