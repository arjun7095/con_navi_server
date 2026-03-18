const PostConflictSession = require('../models/PostConflictSession');
const { sendPushToUser } = require('./notificationController'); // assume you have this

exports.createSession = async (req, res) => {
  const userId = req.user.userId;  // from auth middleware

  const session = new PostConflictSession({ userId, status: 'in_progress' });
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
  if (session.status === 'completed') return res.status(400).json({ error: 'Session already completed' });

  session.step1 = { rating, category };
  session.status = 'in_progress';  // ensure
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
    const { reflection } = req.body;

    if (!reflection) {
      return res.status(400).json({
        success: false,
        message: 'reflection is required',
      });
    }

    const { terms } = reflection;

    if (!Array.isArray(terms)) {
      return res.status(400).json({
        success: false,
        message: 'terms must be an array',
      });
    }

    for (const term of terms) {
      if (!term.option || !term.description) {
        return res.status(400).json({
          success: false,
          message: 'Each term must have option and description',
        });
      }
    }

    const session = await PostConflictSession.findById(sessionId);
    if (!session || session.userId.toString() !== req.user.userId) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    session.step3 = {
      experience: reflection.experience || '',
      react: reflection.react || '',
      assumption: reflection.assumption || '',
      thoughts: reflection.thoughts || '',
      understanding: reflection.understanding || '',
      terms,
    };

    await session.save();

    res.json({
      success: true,
      step3: session.step3,
      nextStep: 4,
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    session.status = 'completed';
    session.completedAt = new Date();

    if (session.startedAt && !session.conflictTime) {
      session.conflictTime = Math.round(
        (session.completedAt - session.startedAt) / (1000 * 60)
      );
    }

    session.step5 = {
      status: 'completed',
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
    resumable: session.status !== 'completed',
    // nextStep: getNextStep(session),
  });
};

// Optional: Explicit resume endpoint (if app needs to "reactivate")
exports.resumeSession = async (req, res) => {
  const { sessionId } = req.params;

  const session = await PostConflictSession.findOne({ _id: sessionId, userId: req.user.userId });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'completed') return res.status(400).json({ error: 'Session already completed' });

  session.lastUpdatedAt = new Date();  // mark as active
  await session.save();

  // Optional push: "Resuming your reflection – let's continue!"
  await sendPushToUser(req.user.userId, 'Resume Reflection', 'Pick up where you left off in your post-conflict session.');

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