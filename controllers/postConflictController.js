const PostConflictSession = require('../models/PostConflictSession');
const { sendPushToUser } = require('./notificationController'); // assume you have this
const { CONFLICT_SESSION_STATUS, isResumableConflictStatus } = require('../utils/conflictSessionStatus');
const {
  buildInterruptionReminderState,
  clearInterruptionReminderState,
} = require('../utils/interruptedConflictReminder');
const { buildSessionNotificationData } = require('../utils/notificationRouting');

exports.createSession = async (req, res) => {
  const userId = req.user.userId;  // from auth middleware

  const session = new PostConflictSession({
    userId,
    status: CONFLICT_SESSION_STATUS.ACTIVE,
  });
  await session.save();

  res.status(201).json({
    success: true,
    sessionId: session._id,
    message: 'Post-Conflict Session started',
    nextStep: 1,
  });
};

exports.updateStep1 = async (req, res) => {
  const { sessionId } = req.params;
  const { rating } = req.body;

  if (!rating || rating < 1 || rating > 10) return res.status(400).json({ error: 'Invalid rating' });

  const category = getDistressCategory(rating);

  const session = await PostConflictSession.findById(sessionId);
  if (!session || session.userId.toString() !== req.user.userId) return res.status(404).json({ error: 'Session not found' });
  if (session.status === CONFLICT_SESSION_STATUS.COMPLETED) return res.status(400).json({ error: 'Session already completed' });

  session.step1 = { rating, category };
  session.status = CONFLICT_SESSION_STATUS.ACTIVE;
  clearInterruptionReminderState(session);
  await session.save();

  res.json({
    success: true,
    step1: session.step1,
    nextStep: 2,
  });
};

exports.updateStep2Feelings = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { presentFeelings, desiredFeelings } = req.body;

    if (!Array.isArray(presentFeelings) || !Array.isArray(desiredFeelings)) {
      return res.status(400).json({
        success: false,
        message: 'Both presentFeelings and desiredFeelings must be arrays',
      });
    }

    const session = await PostConflictSession.findById(sessionId);
    if (!session || session.userId.toString() !== req.user.userId) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    session.step2 = {
      presentFeelings,
      desiredFeelings,
    };
    session.status = CONFLICT_SESSION_STATUS.ACTIVE;
    clearInterruptionReminderState(session);

    await session.save();

    res.json({
      success: true,
      step2: session.step2,
      nextStep: 3,
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateStep3Reflection = async (req, res) => {
  try { 
    const { sessionId } = req.params; 
  const { reflection } = req.body; // the new nested structure 
  // console.log('Received updateStep3 request:', reflection.terms ? terms count: "${reflection.terms.length}" : 'no terms'); // log terms info 
  // // 1. Basic payload validation 
  if (!reflection || typeof reflection !== 'object') { 
    return res.status(400).json({ 
      success: false, 
      message: 'reflection object is required in the payload', 
    }); 
  }
  // 2. Validate named fields (optional – but good practice) 
  const requiredTextFields = ['experience', 'react', 'assumption', 'thoughts', 'understanding']; 
  for (const field of requiredTextFields) { 
    if (typeof reflection[field] !== 'string' || reflection[field].trim() === '') { 
      return res.status(400).json({ success: false, message: "${field} must be a non-empty string",

      }); 
    } 
  } 
    // 3. Validate terms array 
  const { terms } = reflection; 
  if (!Array.isArray(terms)) { 
    return res.status(400).json({ 
      success: false, 
      message: 'terms must be an array',
     }); 
  } 
  for (const term of terms) { 
    if (!term.option || typeof term.option !== 'string' || term.option.trim() === '') { 
      return res.status(400).json({ 
        success: false, 
        message: 'Each term must have a non-empty "option" string', 
      }); 
    } 
    if (!term.description || typeof term.description !== 'string' || term.description.trim() === '') { 
      return res.status(400).json({ 
        success: false, 
        message: 'Each term must have a non-empty "description" string', 
      }); 
    } 
    // Any extra fields (str1, str2, note, priority, etc.) are allowed and ignored here 
    } 
    // 4. Find and authorize session 
    const session = await PostConflictSession.findById(sessionId); 
    if (!session || session.userId.toString() !== req.user.userId) { 
      return res.status(404).json({ success: false, message: 'Session not found' }); } 
    // 5. Update step3 with new structure 
    session.step3 = { experience: reflection.experience || '', react: reflection.react || '', assumption: reflection.assumption || '', thoughts: reflection.thoughts || '', understanding: reflection.understanding || '', terms: terms || [], // array of objects with option + description + any extras
    }; 
    session.status = CONFLICT_SESSION_STATUS.ACTIVE;
    clearInterruptionReminderState(session);
    await session.save(); // 6. Return success response 
    res.json({ success: true, step3: session.step3, nextStep: 4, message: 'Step 3 updated successfully', }); 
  } 
    catch (error) { 
    console.error('updateStep3 error:', error); 
    res.status(500).json({ success: false, message: 'Server error while updating step 3', error: error.message, }); 
  } 
};

exports.updateStep4Rating = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 10) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 10',
      });
    }

    const session = await PostConflictSession.findById(sessionId);
    if (!session || session.userId.toString() !== req.user.userId) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const category = getDistressCategory(rating);
    const feedbackMessage = getFeedbackMessage(session.step1.rating, rating);

    session.step4 = { rating, category, feedbackMessage };
    session.status = CONFLICT_SESSION_STATUS.ACTIVE;
    clearInterruptionReminderState(session);

    await session.save();

    res.json({
      success: true,
      step4: session.step4,
      nextStep: 5,
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.completeSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await PostConflictSession.findById(sessionId);
    if (!session || session.userId.toString() !== req.user.userId) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    if (!session.step1 || !session.step2 || !session.step3 || !session.step4) {
      return res.status(400).json({
        success: false,
        message: 'All steps must be completed',
      });
    }

    session.status = CONFLICT_SESSION_STATUS.COMPLETED;
    session.completedAt = new Date();
    clearInterruptionReminderState(session);

    if (session.startedAt && !session.conflictTime) {
      session.conflictTime = Math.round(
        (session.completedAt - session.startedAt) / (1000 * 60)
      );
    }

    session.step5 = {
      status: CONFLICT_SESSION_STATUS.COMPLETED,
    };

    await session.save();

    res.json({
      success: true,
      message: 'Session completed successfully',
      session,
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Helpers
function getDistressCategory(rating) {
  if (rating <= 3) return 'Low Distress';
  if (rating <= 6) return 'Moderate Distress';
  if (rating <= 9) return 'High Distress';
  return 'Very High Distress';
}

function getFeedbackMessage(initial, final) {
  if (final < initial) return 'Excellent progress! You\'ve successfully processed this conflict.';
  if (final === initial) return 'Stable reflection - good work maintaining clarity.';
  return 'Reflection noted - consider more strategies for reduction.';
}


// Updated getSession (for resumption)
exports.getSessions = async (req, res) => {
  const { sessionId } = req.params;
  // const session = await PostConflictSession.findOne({ _id: sessionId, userId: req.user.userId });
  const session = await PostConflictSession.findOne({ _id: sessionId });
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    success: true,
    session,
    resumable: isResumableConflictStatus(session.status),
    // nextStep: getNextStep(session),
  });
};

// Optional: Explicit resume endpoint (if app needs to "reactivate")
exports.resumeSession = async (req, res) => {
  const { sessionId } = req.params;

  const session = await PostConflictSession.findOne({ _id: sessionId, userId: req.user.userId });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === CONFLICT_SESSION_STATUS.COMPLETED) return res.status(400).json({ error: 'Session already completed' });

  session.status = CONFLICT_SESSION_STATUS.ACTIVE;
  session.resumedAt = new Date();
  session.pausedAt = null;
  session.lastUpdatedAt = new Date();  // mark as active
  clearInterruptionReminderState(session);
  await session.save();

  // Optional push: "Resuming your reflection – let's continue!"
  await sendPushToUser(
    req.user.userId,
    'Resume Reflection',
    'Pick up where you left off in your post-conflict session.',
    buildSessionNotificationData(session, 'post', {
      type: 'session_resumed',
      notificationContext: 'resume_session',
    })
  );

  res.json({
    success: true,
    session,
    nextStep: getNextStep(session),
  });
};

function getNextStep(session) {
  if (!session.step1) return 1;
  if (!session.step2) return 2;
  if (!session.step3) return 3;
  if (!session.step4) return 4;
  if (!session.step5) return 5;
  return null;
}

exports.getUserSessions = async (req, res) => {
  try {
    const sessions = await PostConflictSession.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .lean();

    const enhanced = sessions.map(s => ({
      ...s,
      resumable: isResumableConflictStatus(s.status),
    }));

    res.json({
      success: true,
      sessions: enhanced,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.markSessionInterrupted = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await PostConflictSession.findOne({
      _id: sessionId,
      userId: req.user.userId,
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    if (session.status === CONFLICT_SESSION_STATUS.COMPLETED) {
      return res.status(400).json({ success: false, message: 'Completed sessions cannot be interrupted' });
    }

    const now = new Date();
    session.status = CONFLICT_SESSION_STATUS.PAUSED;
    session.pausedAt = now;
    session.interruptionReminder = buildInterruptionReminderState(now);

    await session.save();

    res.json({
      success: true,
      message: 'Post-conflict session marked as interrupted',
      sessionId: session._id,
      status: session.status,
      nextReminderAt: session.interruptionReminder.nextReminderAt,
    });
  } catch (error) {
    console.error('markSessionInterrupted error:', error);
    res.status(500).json({ success: false, message: 'Server error while marking session interrupted' });
  }
};
