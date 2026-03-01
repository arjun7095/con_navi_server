// src/controllers/liveConflictController.js
const LiveConflictSession = require('../models/LiveConflictSession');
// const { sendPushToUser } = require('./notificationController'); // if you have it; otherwise comment out
const { cancelReminder } = require('../utils/scheduler');

// Helper: Calculate distress category
const getDistressCategory = (rating) => {
  if (rating <= 3) return 'Low Distress';
  if (rating <= 6) return 'Moderate Distress';
  if (rating <= 9) return 'High Distress';
  return 'Very High Distress';
};

// 1. Create new Live Conflict session
exports.createLiveSession = async (req, res) => {
  try {
    const userId = req.user.userId;

    // const existingActive = await LiveConflictSession.findOne({
    //   userId,
    //   status: { $in: ['active', 'paused'] },
    // });

    // if (existingActive) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'You already have an active or paused Live Conflict session. Please resume or complete it first.',
    //     sessionId: existingActive._id,
    //     currentStep: existingActive.currentStep,
    //   });
    // }

    const session = new LiveConflictSession({
      userId,
      status: 'active',
      currentStep: 1,
    });

    await session.save();

    res.status(201).json({
      success: true,
      message: 'Live Conflict session started',
      sessionId: session._id,
      currentStep: 1,
      session,
    });
  } catch (error) {
    console.error('createLiveSession error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// 2. Generic update step endpoint (handles step 1–12)
exports.updateStep = async (req, res) => {
  try {
    const { sessionId, stepNumber } = req.params;
    const step = Number(stepNumber);

    if (step < 1 || step > 12) {
      return res.status(400).json({ success: false, message: 'Invalid step number (1–12)' });
    }

    const session = await LiveConflictSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    if (session.userId.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to session' });
    }

    if (session.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Session already completed' });
    }

    if (session.status === 'paused') {
      return res.status(400).json({
        success: false,
        message: 'Session is paused. Resume first.',
        currentStep: session.currentStep,
      });
    }

    let updated = false;

    switch (step) {
      case 1: {
        const { rating } = req.body;
        if (typeof rating !== 'number' || rating < 1 || rating > 10) {
          return res.status(400).json({ success: false, message: 'Rating must be 1–10' });
        }
        session.initialDistress = {
          rating,
          category: getDistressCategory(rating),
        };
        // session.currentStep = 2;
        updated = true;
        break;
      }

      case 2: {
        const { doBreathing } = req.body;
        if (typeof doBreathing !== 'boolean') {
          return res.status(400).json({ success: false, message: 'doBreathing must be boolean' });
        }
        session.isBreathingExercise = doBreathing;
        // session.currentStep = 3;
        updated = true;
        break;
      }

      case 3: {
        const { presentFeelings, desiredFeelings } = req.body;
        if (!Array.isArray(presentFeelings) || !Array.isArray(desiredFeelings)) {
          return res.status(400).json({ success: false, message: 'presentFeelings and desiredFeelings must be arrays' });
        }
        session.presentFeelings = presentFeelings;
        session.desiredFeelings = desiredFeelings;
        session.currentStep = 4;
        updated = true;
        break;
      }

      case 4: {
  const { continue: cont, break: brk, breakReason, resumeAt } = req.body;

  if (cont === true) {
    // Continue to step 5
    session.currentStep = 5;
    updated = true;
  } else if (brk === true) {
    session.choseToBreak = true;
    session.breakReason = breakReason || 'No reason provided';

    if (resumeAt) {
      const resumeDate = new Date(resumeAt);
      if (!isNaN(resumeDate.getTime()) && resumeDate > new Date()) {
        const { scheduleReminder } = require('../utils/scheduler');
        await scheduleReminder(
          req.user.userId,
          resumeDate,
          sessionId,
          'It’s time to continue your Live Conflict reflection!'
        );
        session.resumeAt = resumeDate;
      } else {
        console.warn(`Invalid resumeAt for session ${sessionId} – ignoring`);
      }
    }

    session.currentStep = 12; // Jump to final step
    updated = true;
  } else {
    return res.status(400).json({ success: false, message: 'Must specify continue: true or break: true' });
  }
  break;
}
      case 5: {
        const { agreed } = req.body;
        if (typeof agreed !== 'boolean') {
          return res.status(400).json({ success: false, message: 'agreed must be boolean' });
        }
        session.nonNegotiablesAgreed = agreed;
        session.currentStep = 6;
        updated = true;
        break;
      }

      case 6: {
  const { selection } = req.body;  // "speaking" or "listening"

  if (!['speaking', 'listening'].includes(selection)) {
    return res.status(400).json({
      success: false,
      message: 'selection must be "speaking" or "listening"',
    });
  }

  // Reset unfinished cycle if returning to step 6
  const lastCycle = session.conversationCycles[session.conversationCycles.length - 1];
  if (lastCycle && !lastCycle.completed) {
    lastCycle.speaking = {};
    lastCycle.listening = {};
    lastCycle.selection = null;
    lastCycle.completed = false;
    console.log(`Cycle ${lastCycle.cycleNumber} reset – returned to step 6`);
  }

  // Always move to step 7, but remember selection
  session.currentStep = 7;

  // If new cycle needed, create it
  if (!lastCycle || lastCycle.completed) {
    const newCycle = {
      cycleNumber: session.conversationCycles.length + 1,
      selection,
      speaking: {},
      listening: {},
      completed: false,
    };
    session.conversationCycles.push(newCycle);
  } else {
    // Reuse existing cycle (user corrected choice)
    lastCycle.selection = selection;
  }

  updated = true;
  break;
}

case 7: {
  // Step 7 is static instructions – no payload needed
  // Move forward based on current cycle's selection

  const currentCycle = session.conversationCycles[session.conversationCycles.length - 1];

  if (!currentCycle || !currentCycle.selection) {
    return res.status(400).json({
      success: false,
      message: 'No active cycle or selection found – return to step 6',
    });
  }

  // Redirect based on selection
  session.currentStep = currentCycle.selection === 'speaking' ? 8 : 9;
  updated = true;
  break;
}

case 8: {
  // Speaking path only – should only be reachable if selection = speaking
  const currentCycle = session.conversationCycles[session.conversationCycles.length - 1];

  if (!currentCycle || currentCycle.selection !== 'speaking') {
    return res.status(400).json({
      success: false,
      message: 'Step 8 is only for speaking path – return to step 6',
    });
  }

  const {
    experience,
    assumptions,
    helpStructureSelected,
    when,
    request,
  } = req.body;

  if (experience) currentCycle.speaking.experience = experience.trim();
  if (assumptions) currentCycle.speaking.assumptions = assumptions.trim();
  currentCycle.speaking.helpStructureSelected = !!helpStructureSelected;

  if (helpStructureSelected) {
    if (!when || !request) {
      return res.status(400).json({
        success: false,
        message: '"when" and "request" required when helpStructureSelected is true',
      });
    }

    currentCycle.speaking.when = when.trim();
    currentCycle.speaking.request = request.trim();

    currentCycle.speaking.structuredStatements = [
      `When: ${when.trim()}`,
      `I feel: ${session.presentFeelings?.join(', ') || '...'}`,
      `I need: ${session.desiredFeelings?.join(', ') || '...'}`,
      `Would you be willing to... ${request.trim()}`
    ];
  }

  // After speaking → back to step 7 (now for listening)
  session.currentStep = 7;
  updated = true;
  break;
}

case 9: {
  // Listening path only
  const currentCycle = session.conversationCycles[session.conversationCycles.length - 1];

  if (!currentCycle || currentCycle.selection !== 'listening') {
    return res.status(400).json({
      success: false,
      message: 'Step 9 is only for listening path – return to step 6',
    });
  }

  const { communicated } = req.body;

  if (!communicated || typeof communicated !== 'string' || communicated.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'communicated string is required',
    });
  }

  currentCycle.listening.communicated = communicated.trim();
  currentCycle.listening.timestamp = new Date();

  // Check if cycle is complete
  if (currentCycle.speaking.experience) {
    currentCycle.completed = true;
  }

  session.currentStep = 10;
  updated = true;
  break;
}

case 10: {
  const { markAsResolved, continueReflection } = req.body;

  const currentCycle = session.conversationCycles[session.conversationCycles.length - 1];

  if (!currentCycle) {
    return res.status(400).json({ success: false, message: 'No active cycle' });
  }

  if (markAsResolved === true) {
    if (!currentCycle.completed) {
      return res.status(400).json({
        success: false,
        message: 'Complete both speaking and listening in the current cycle first',
      });
    }
    session.currentStep = 11;
    updated = true;
  } else if (continueReflection === true) {
    session.currentStep = 6;
    updated = true;
  } else {
    return res.status(400).json({
      success: false,
      message: 'Must send markAsResolved: true or continueReflection: true',
    });
  }
  break;
}

      case 11: {
        const { rating } = req.body;
        if (typeof rating !== 'number' || rating < 1 || rating > 10) {
          return res.status(400).json({ success: false, message: 'Rating must be 1–10' });
        }
        session.finalDistress = {
          rating,
          category: getDistressCategory(rating),
        };
        session.currentStep = 12;
        updated = true;
        break;
      }

      case 12: {
        // Final completion
        session.isCompleted = true;
        updated = true;
        break;
      }

      default:
        return res.status(400).json({ success: false, message: 'Invalid step' });
    }

    if (updated) {
      if (session.currentStep < 12) {
        session.currentStep += 1;
      }
      await session.save();

      res.json({
        success: true,
        message: `Step ${step} updated`,
        currentStep: session.currentStep,
        session,
      });
    }
  } catch (error) {
    console.error('updateStep error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// 3. Pause session
exports.pauseSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { reason, resumeAt } = req.body;

    const session = await LiveConflictSession.findById(sessionId);
    if (!session || session.userId.toString() !== req.user.userId) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    if (session.status === 'paused') {
      return res.status(400).json({ success: false, message: 'Session already paused' });
    }

    session.status = 'paused';
    session.pausedAt = new Date();

    session.pauseHistory.push({
      pausedAt: new Date(),
      reason: reason || 'No reason provided',
      resumedAt: null,
    });

    if (resumeAt) {
      const resumeDate = new Date(resumeAt);
      if (!isNaN(resumeDate.getTime()) && resumeDate > new Date()) {
        const { scheduleReminder } = require('../utils/scheduler');
        await scheduleReminder(
          req.user.userId,
          resumeDate,
          sessionId,
          'It’s time to continue your Live Conflict reflection!'
        );
        session.resumeAt = resumeDate;
      } else {
        console.warn(`Invalid resumeAt for session ${sessionId} – ignoring`);
      }
    }

    await session.save();

    res.json({
      success: true,
      message: 'Session paused',
      paused: true,
      session,
    });
  } catch (error) {
    console.error('pauseSession error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// 4. Resume session
exports.resumeSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await LiveConflictSession.findById(sessionId);
    if (!session || session.userId.toString() !== req.user.userId) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    if (session.status !== 'paused') {
      return res.status(400).json({ success: false, message: 'Session is not paused' });
    }

    // Cancel any scheduled resume reminder
    const { cancelReminder } = require('../utils/scheduler');
    cancelReminder(sessionId.toString());  // use string ID for safety

    // Resume the session
    session.status = 'active';
    session.resumedAt = new Date();

    // Update the last pause history entry
    const lastPause = session.pauseHistory[session.pauseHistory.length - 1];
    if (lastPause && !lastPause.resumedAt) {
      lastPause.resumedAt = new Date();
    }

    await session.save();

    res.json({
      success: true,
      message: 'Session resumed successfully',
      resumed: true,
      currentStep: session.currentStep,
      session,
    });
  } catch (error) {
    console.error('resumeSession error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to resume session', 
      error: error.message 
    });
  }
};

// 5. Get all user's live sessions (history)
exports.getUserSessions = async (req, res) => {
  try {
    const sessions = await LiveConflictSession.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .lean();

    const enhanced = sessions.map(s => ({
      ...s,
      resumable: s.status === 'paused' || s.status === 'active',
    }));

    res.json({
      success: true,
      sessions: enhanced,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 6. Get single session
exports.getSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await LiveConflictSession.findOne({
      _id: sessionId,
      userId: req.user.userId,
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    res.json({
      success: true,
      session,
      resumable: session.status === 'paused' || session.status === 'active',
      currentStep: session.currentStep,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 7. Complete session (can be called from step 12 or manually)
exports.completeSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await LiveConflictSession.findById(sessionId);
    if (!session || session.userId.toString() !== req.user.userId) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    if (session.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Session already completed' });
    }

    // Cancel any pending resume reminder
    const { cancelReminder } = require('../utils/scheduler');
    cancelReminder(sessionId.toString());

    // Mark as completed
    session.isCompleted = true;
    session.status = 'completed';
    session.completedAt = new Date();

    // Optional: calculate final duration if not already set
    if (session.startedAt && !session.totalDurationMinutes) {
      session.totalDurationMinutes = Math.round((new Date() - session.startedAt) / (1000 * 60));
    }

    await session.save();

    // Optional: send completion push notification
    // await sendPushToUser(req.user.userId, 'Live Conflict Completed', 'Great job! Review your session summary.');

    res.json({
      success: true,
      message: 'Live Conflict session completed successfully',
      session,
    });
  } catch (error) {
    console.error('completeSession error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to complete session', 
      error: error.message 
    });
  }
};