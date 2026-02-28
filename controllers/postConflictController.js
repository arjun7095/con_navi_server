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

exports.updateStep2 = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { reflection } = req.body;  // the new nested structure
    console.log('Received updateStep2 request:', reflection.terms ? `terms count: ${reflection.terms.length}` : 'no terms');  // log terms info 

    // 1. Basic payload validation
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
        return res.status(400).json({
          success: false,
          message: `${field} must be a non-empty string`,
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
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    // 5. Update step2 with new structure
    session.step2 = {
      experience:    reflection.experience    || '',
      react:         reflection.react         || '',
      assumption:    reflection.assumption    || '',
      thoughts:      reflection.thoughts      || '',
      understanding: reflection.understanding || '',
      terms:         terms || [],               // array of objects with option + description + any extras
    };

    await session.save();

    // 6. Return success response
    res.json({
      success: true,
      step1: session.step1,
      step2: session.step2,
      nextStep: 3,
      message: 'Step 2 updated successfully',
    });
  } catch (error) {
    console.error('updateStep2 error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating step 2',
      error: error.message,
    });
  }
};

exports.updateStep3 = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 10) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 10' });
    }

    const session = await PostConflictSession.findById(sessionId);
    if (!session || session.userId.toString() !== req.user.userId) {
      return res.status(404).json({ success: false, message: 'Session not found or unauthorized' });
    }

    // Optional: enforce step order
    if (!session.step1?.rating) {
      return res.status(400).json({
        success: false,
        message: 'Step 1 must be completed before Step 3',
      });
    }

    const category = getDistressCategory(rating);
    const feedbackMessage = getFeedbackMessage(session.step1.rating, rating);

    session.step3 = { rating, category, feedbackMessage };
    await session.save();

    res.json({
      success: true,
      step1: session.step1,
      step2: session.step2,
      step3: session.step3,
      nextStep: 4,
    });
  } catch (error) {
    console.error('updateStep3 error:', error);
    res.status(500).json({ success: false, message: 'Server error while updating step 3' });
  }
};

exports.completeSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await PostConflictSession.findById(sessionId);
    if (!session || session.userId.toString() !== req.user.userId) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    // Ensure all steps are filled before completing
    if (!session.step1 || !session.step2 || !session.step3) {
      return res.status(400).json({
        success: false,
        message: 'All steps must be completed before finalizing the session',
      });
    }

    // Mark as completed
    session.status = 'completed';
    session.completedAt = new Date();

    if (session.startedAt && !session.conflictTime) {
      session.conflictTime = Math.round((session.completedAt - session.startedAt) / (1000 * 60));
    }

    // Generate and save summary (if not already)
    if (!session.step4?.summary) {
      session.step4 = {
        summary: generateSummary(session),
      };
    }

    await session.save();

    res.json({
      success: true,
      message: 'Session completed successfully',
      session,
    });
  } catch (error) {
    console.error('completeSession error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
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

function generateSummary(session) {
  if (!session.step2) {
    return 'Reflection summary not available yet – complete Step 2 first.';
  }

  const { experience, react, assumption, thoughts, understanding, terms = [] } = session.step2;

  let summary = 'Your Reflection Summary:\n\n';

  summary += `Experience:\n${experience || 'Not provided'}\n\n`;
  summary += `Your Reaction:\n${react || 'Not provided'}\n\n`;
  summary += `Assumptions Made:\n${assumption || 'Not provided'}\n\n`;
  summary += `Thoughts During Conflict:\n${thoughts || 'Not provided'}\n\n`;
  summary += `Understanding Gained:\n${understanding || 'Not provided'}\n\n`;

  if (terms.length > 0) {
    summary += 'Key Terms / Needs Identified:\n';
    terms.forEach((term, index) => {
      summary += `\nTerm ${index + 1}:\n`;
      summary += `  Option: ${term.option || 'N/A'}\n`;
      summary += `  Description: ${term.description || 'N/A'}\n`;

      // Dynamically add any extra fields (str1, str2, note, etc.)
      Object.entries(term)
        .filter(([key]) => !['option', 'description'].includes(key))
        .forEach(([key, value]) => {
          summary += `  ${key}: ${value || 'N/A'}\n`;
        });
    });
  } else {
    summary += 'No terms/needs identified in this reflection.\n';
  }

  return summary.trim();
}

// Updated getSessions (history list)
exports.getSessions = async (req, res) => {
  const sessions = await PostConflictSession.find({ userId: req.user.userId }).sort({ createdAt: -1 });
  const enhancedSessions = sessions.map(session => ({
    ...session.toObject(),
    resumable: session.status !== 'completed',
    nextStep: getNextStep(session),  // ← NEW helper
  }));
  res.json({ success: true, sessions: enhancedSessions });
};

// Updated getSession (for resumption)
exports.getSession = async (req, res) => {
  const { sessionId } = req.params;
  const session = await PostConflictSession.findOne({ _id: sessionId, userId: req.user.userId });
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    success: true,
    session,
    resumable: session.status !== 'completed',
    nextStep: getNextStep(session),
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
  return null;  // completed
}