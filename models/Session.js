// src/models/Session.js
const mongoose = require('mongoose');

const ReflectionCycleSchema = new mongoose.Schema({
  content:            { type: String, trim: true },
  response:           { type: String, trim: true },
  cycle:              { type: Number, min: 1 },
  timestamp:          { type: Date, default: Date.now },
});

const StepTimeSchema = new mongoose.Schema({
  step:               { type: String, required: true },   // "observation", "feelings", "resolution", ...
  duration:           { type: Number, default: 0 },       // seconds
  startTimestamp:     { type: Date },
  endTimestamp:       { type: Date },
});

const SessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // Core type
  mode: {
    type: String,
    enum: ['live', 'post'],
    required: true,
  },

  // Progress & state
  status: {
    type: String,
    enum: ['in_progress', 'paused', 'completed', 'abandoned'],
    default: 'in_progress',
  },
  currentStep: {
    type: String,
    default: 'observation',   // first step name
  },

  // Timing (very important for your requirement)
  totalDuration:        { type: Number, default: 0 },     // total seconds
  stepTimes:            [StepTimeSchema],

  // Emotional & content fields (from your sample)
  distressLevel:        { type: Number, min: 0, max: 10 },
  finalDistress:        { type: Number, min: 0, max: 10 },

  selectedFeelings:     [{ type: String }],
  selectedNeeds:        [{ type: String }],

  observation:          { type: String, trim: true },
  request:              { type: String, trim: true },
  finalStatement:       { type: String, trim: true },

  reflection:           { type: String, trim: true },
  assumptions:          { type: String, trim: true },
  reaction:             { type: String, trim: true },
  understanding:        { type: String, trim: true },
  mutualUnderstanding:  { type: String, trim: true },

  feltHeard:            [{ type: String }],
  notHeardReason:       { type: String, trim: true },
  theyNotHeardReason:   { type: String, trim: true },

  otherPartyPerspective:{ type: String, trim: true },
  reflectionResponse:   { type: String, trim: true },
  confirmationResponse: { type: String, trim: true },

  insights:             { type: String, trim: true },

  // ATS / resolution phase
  atsDecision:          { type: String, trim: true },
  atsAffirmation:       { type: String, trim: true },
  atsTableActivity:     { type: String, trim: true },
  atsReturnTime:        { type: Date },
  atsScheduledTime:     { type: Date },

  nonNegotiablesAgreed: { type: Boolean, default: false },
  manualCheck:          { type: Boolean, default: false },
  autoNotify:           { type: Boolean, default: false },

  speakingOrder:        { type: String, enum: ['me_first', 'them_first', 'alternate', null] },

  // Reflection loop
  reflectionCycleCount: { type: Number, default: 0 },
  reflectionCycles:     [ReflectionCycleSchema],

  // Sharing & misc
  disclaimerShown:      { type: Boolean, default: false },
  shareableId:          { type: String, sparse: true, unique: true },
  isPublic:             { type: Boolean, default: false },

  createdAt:            { type: Date, default: Date.now },
  updatedAt:            { type: Date, default: Date.now },
});

SessionSchema.pre('save', function() {
  this.updatedAt = new Date();
  
});

module.exports = mongoose.model('Session', SessionSchema);