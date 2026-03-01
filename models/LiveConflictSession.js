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
  resumeAt: Date,               // for scheduled push notification

  // Step 5
  nonNegotiablesAgreed: { type: Boolean, default: false },

  // Steps 6–10: Conversation cycles (updated structure)
  conversationCycles: [{
    cycleNumber: { type: Number, required: true },

    speaking: {
      experience: { type: String, trim: true },                    // "What was your experience?"
      assumptions: { type: String, trim: true },                   // "What assumptions might you be making?"
      helpStructureSelected: { type: Boolean, default: false },    // Checkbox in step 8

      // NEW: these two come directly from payload when checkbox is true
      when: { type: String, trim: true },                          // "When..." string
      request: { type: String, trim: true },                       // "Would you be willing to..." / request string

      // Generated result (stored for display/summary)
      structuredStatements: [{ type: String }],

      timestamp: { type: Date, default: Date.now },
    },

    listening: {
      communicated: { type: String, trim: true },                  // "What did the other person communicate to you?"
      timestamp: { type: Date, default: Date.now },
    },

    completed: { type: Boolean, default: false },                  // true only after both speaking & listening are filled
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

// Auto-update fields on save
liveConflictSchema.pre('save', function (next) {
  this.updatedAt = new Date();

  if (this.isCompleted) {
    this.status = 'completed';
    this.completedAt = new Date();
    if (this.startedAt) {
      this.totalDurationMinutes = Math.round((this.completedAt - this.startedAt) / (1000 * 60));
    }
  }

});

module.exports = mongoose.model('LiveConflictSession', liveConflictSchema);