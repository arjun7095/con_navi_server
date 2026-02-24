const Session = require('../models/Session');

// Helper: Calculate seconds between two dates
const getDurationSeconds = (start, end) => {
  if (!start || !end) return 0;
  return Math.floor((end - start) / 1000);
};

// 1. Create new session
exports.createSession = async (req, res) => {
  try {
    // ← Add this guard clause
    // console.log('createSession called with user:', req.user);
    if (!req.user || !req.user.userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication failed - user not found in request',
      });
    }

    const { mode } = req.body;
    if (!['live', 'post'].includes(mode)) {
      return res.status(400).json({ success: false, message: 'Mode must be "live" or "post"' });
    }

    // ... rest of your code

    const session = new Session({
      userId: req.user.userId,           // ← this line was failing
      mode,
      currentStep: 'observation',
      stepTimes: [{ step: 'observation', startTimestamp: new Date() }],
    });

    await session.save();

    res.status(201).json({
      success: true,
      message: 'New session created',
      session,
    });
  } catch (err) {
    console.error('createSession error:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: err.errors,
      });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 2. Get all sessions of the user
exports.getUserSessions = async (req, res) => {
  try {
    const sessions = await Session.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .select('-stepTimes -reflectionCycles'); // lightweight list

    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 3. Get full single session
exports.getSessionById = async (req, res) => {
  try {
    const session = await Session.findOne({
      _id: req.params.id,
      userId: req.user.userId,
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 4. Resume session (restart timing on current step)
exports.resumeSession = async (req, res) => {
  try {
    const session = await Session.findOne({
      _id: req.params.id,
      userId: req.user.userId,
    });

    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (session.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Session already completed' });
    }

    session.status = 'in_progress';

    // (Re)start timer for current step
    const stepEntry = session.stepTimes.find(s => s.step === session.currentStep);
    if (stepEntry) {
      stepEntry.startTimestamp = new Date();
    } else {
      session.stepTimes.push({
        step: session.currentStep,
        startTimestamp: new Date(),
      });
    }

    await session.save();

    res.json({ success: true, message: 'Session resumed', session });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 5. Core progress endpoint (update data + move / pause / complete)
exports.updateSessionProgress = async (req, res) => {
  const { id } = req.params;
  const { step, data = {}, action } = req.body;

  try {
    const session = await Session.findOne({ _id: id, userId: req.user.userId });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    if (session.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Session already completed' });
    }

    // 1. Calculate time spent in PREVIOUS step (if changing step)
    if (session.currentStep !== step && session.status === 'in_progress') {
      const prevEntry = session.stepTimes.find(s => s.step === session.currentStep);
      if (prevEntry && prevEntry.startTimestamp) {
        const now = new Date();
        const duration = getDurationSeconds(prevEntry.startTimestamp, now);
        prevEntry.duration += duration;
        prevEntry.endTimestamp = now;
        session.totalDuration += duration;
      }
    }

    // 2. Apply new data (any fields sent in data object)
    Object.assign(session, data);

    // 3. Handle requested action
    if (action === 'pause') {
      session.status = 'paused';
    } else if (action === 'complete') {
      session.status = 'completed';
      // Final timing flush
      const currentEntry = session.stepTimes.find(s => s.step === session.currentStep);
      if (currentEntry && currentEntry.startTimestamp) {
        const now = new Date();
        const duration = getDurationSeconds(currentEntry.startTimestamp, now);
        currentEntry.duration += duration;
        currentEntry.endTimestamp = now;
        session.totalDuration += duration;
      }
    } else if (step && step !== session.currentStep) {
      // Move to new step (validate sequential for live mode)
      // Inside updateSessionProgress controller
if (session.mode === 'live') {
  const stepOrder = [
    'observation',
    'feelings',
    'needs',
    'request',
    'resolution',           // or 'ats' / 'reflection' etc.
    'reflection',
    'mutual_understanding',
    'final_statement'
    // add ALL possible steps in correct order
  ];

  const currentIdx = stepOrder.indexOf(session.currentStep);
  const nextIdx = stepOrder.indexOf(step);

  if (nextIdx === -1 || currentIdx === -1) {
    return res.status(400).json({
      success: false,
      message: 'Invalid step name'
    });
  }

  if (nextIdx !== currentIdx + 1) {
    return res.status(400).json({
      success: false,
      message: `Invalid step transition in live mode (expected ${stepOrder[currentIdx + 1] || 'end'})`
    });
  }
}

      session.currentStep = step;

      // Start timer for new step
      let newEntry = session.stepTimes.find(s => s.step === step);
      if (!newEntry) {
        newEntry = { step, startTimestamp: new Date(), duration: 0 };
        session.stepTimes.push(newEntry);
      } else {
        newEntry.startTimestamp = new Date();
      }
    }

    await session.save();

    res.json({ success: true, message: 'Progress updated', session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 6. Abandon session
exports.abandonSession = async (req, res) => {
  try {
    const session = await Session.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      { status: 'abandoned' },
      { new: true }
    );

    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    res.json({ success: true, message: 'Session abandoned', session });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 7. Get timing summary
exports.getSessionSummary = async (req, res) => {
  try {
    const session = await Session.findOne({
      _id: req.params.id,
      userId: req.user.userId,
    });

    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    const summary = {
      totalDuration: session.totalDuration,
      stepDurations: session.stepTimes.map(st => ({
        step: st.step,
        durationSeconds: st.duration,
      })),
      stepCount: session.stepTimes.length,
      distressChange: session.distressLevel && session.finalDistress
        ? session.finalDistress - session.distressLevel
        : null,
      reflectionCyclesCount: session.reflectionCycleCount,
      completed: session.status === 'completed',
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };

    res.json({ success: true, summary });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};