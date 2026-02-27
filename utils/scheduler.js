// src/utils/scheduler.js
const cron = require('node-cron');
const { sendPushToUser } = require('../controllers/notificationController');
const LiveConflictSession = require('../models/LiveConflictSession');

// In-memory store of scheduled jobs (key: sessionId, value: cron job instance)
const scheduledReminders = new Map();

/**
 * Schedule a resume reminder push notification
 * @param {string} userId
 * @param {Date|string} resumeAt - ISO string or Date object
 * @param {string} sessionId
 * @param {string} [message] - Custom message
 */
exports.scheduleReminder = async (userId, resumeAt, sessionId, message = 'It’s time to continue your Live Conflict reflection!') => {
  try {
    const resumeDate = new Date(resumeAt);
    if (isNaN(resumeDate.getTime()) || resumeDate <= new Date()) {
      console.warn(`Invalid or past resume time for session ${sessionId} – skipping schedule`);
      return;
    }

    // Cancel any existing reminder for this session
    if (scheduledReminders.has(sessionId)) {
      scheduledReminders.get(sessionId).stop();
      scheduledReminders.delete(sessionId);
    }

    // node-cron format: second minute hour day month day-of-week
    const cronExpression = `${resumeDate.getSeconds()} ${resumeDate.getMinutes()} ${resumeDate.getHours()} ${resumeDate.getDate()} ${resumeDate.getMonth() + 1} *`;

    const job = cron.schedule(cronExpression, async () => {
      try {
        const session = await LiveConflictSession.findById(sessionId);
        if (!session || session.status !== 'paused') {
          console.log(`Resume reminder skipped – session ${sessionId} no longer paused`);
          return;
        }

        await sendPushToUser(userId, 'Resume Reminder', message);

        // Optional: clear resumeAt after sending
        session.resumeAt = null;
        await session.save();

        console.log(`Resume reminder sent for session ${sessionId} to user ${userId}`);
      } catch (err) {
        console.error('Scheduled reminder failed:', err);
      } finally {
        // Clean up
        scheduledReminders.delete(sessionId);
      }
    });

    scheduledReminders.set(sessionId, job);

    console.log(`Reminder scheduled for session ${sessionId} at ${resumeDate.toISOString()}`);
  } catch (err) {
    console.error('scheduleReminder error:', err);
  }
};

/**
 * Cancel a scheduled reminder for a session
 * @param {string} sessionId
 */
exports.cancelReminder = (sessionId) => {
  if (scheduledReminders.has(sessionId)) {
    scheduledReminders.get(sessionId).stop();
    scheduledReminders.delete(sessionId);
    console.log(`Reminder cancelled for session ${sessionId}`);
  }
};