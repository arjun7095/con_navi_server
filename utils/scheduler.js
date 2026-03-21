// src/utils/scheduler.js
const cron = require('node-cron');
const { sendPushToUser } = require('../controllers/notificationController');
const LiveConflictSession = require('../models/LiveConflictSession');
const { CONFLICT_SESSION_STATUS } = require('./conflictSessionStatus');
const { buildSessionNotificationData } = require('./notificationRouting');

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
    if (isNaN(resumeDate.getTime())) {
      console.warn(`Invalid resume time for session ${sessionId} – skipping`);
      return;
    }

    const now = new Date();
    if (resumeDate <= now) {
      console.warn(`Resume time ${resumeDate.toISOString()} is in the past or now for session ${sessionId} – skipping schedule`);
      return;
    }

    // Avoid scheduling extremely soon (< 30s) – risk of missing due to delay
    if ((resumeDate - now) < 30_000) {
      console.warn(`Resume time too soon for session ${sessionId} – consider immediate send`);
      return;
    }

    // Cancel existing job if any
    if (scheduledReminders.has(sessionId)) {
      scheduledReminders.get(sessionId).stop();
      scheduledReminders.delete(sessionId);
      console.log(`Existing reminder cancelled for session ${sessionId}`);
    }

    // Round UP to next full minute (prevents node-cron missing due to seconds)
    let targetDate = new Date(resumeDate);
    if (targetDate.getSeconds() > 0 || targetDate.getMilliseconds() > 0) {
      targetDate.setMinutes(targetDate.getMinutes() + 1);
      targetDate.setSeconds(0);
      targetDate.setMilliseconds(0);
      console.log(`Rounded resume time: ${resumeDate.toISOString()} → ${targetDate.toISOString()}`);
    }

    const cronExpression = `0 ${targetDate.getMinutes()} ${targetDate.getHours()} ${targetDate.getDate()} ${targetDate.getMonth() + 1} *`;

    console.log(`Scheduling reminder for session ${sessionId} at ${targetDate.toISOString()} (server time)`);

    const job = cron.schedule(
      cronExpression,
      async () => {
        console.log(`[CRON FIRED] ${new Date().toISOString()} – processing session ${sessionId}`);

        try {
          const session = await LiveConflictSession.findById(sessionId);
          if (!session) {
            console.log(`Session ${sessionId} not found`);
            return;
          }
          if (session.status !== CONFLICT_SESSION_STATUS.PAUSED) {
            console.log(`Session ${sessionId} no longer paused (status: ${session.status})`);
            return;
          }

          console.log(`Attempting resume push → user ${userId}, session ${sessionId}`);
          const pushResult = await sendPushToUser(
            userId,
            'Revisit Paused Conflict',
            message,
            buildSessionNotificationData(session, 'live', {
              type: 'scheduled_resume_reminder',
              notificationContext: 'manual_pause',
            })
          );

          if (pushResult.successCount > 0) {
            console.log(`Resume reminder sent successfully to user ${userId} (session ${sessionId})`);
            session.resumeAt = null;
            await session.save();
          } else {
            console.warn(
              `Resume push failed (${pushResult.failureCount} failed, ${pushResult.failedTokensCount || 0} tokens cleaned) ` +
              `for session ${sessionId} – likely invalid FCM token`
            );
            // Optional: you could mark session or notify admin here
          }
        } catch (err) {
          console.error(`[CRON ERROR] session ${sessionId}:`, err);
        } finally {
          scheduledReminders.delete(sessionId);
          console.log(`Cleaned up job for session ${sessionId}`);
        }
      },
      {
        scheduled: true,
        timezone: 'Asia/Kolkata'  // Explicit IST – prevents timezone surprises
      }
    );

    scheduledReminders.set(sessionId, job);
    console.log(`Reminder scheduled for session ${sessionId} at ~${targetDate.toISOString()}`);
  } catch (err) {
    console.error(`scheduleReminder error for session ${sessionId}:`, err);
  }
};

/**
 * Cancel a scheduled reminder
 * @param {string} sessionId
 */
exports.cancelReminder = (sessionId) => {
  if (scheduledReminders.has(sessionId)) {
    scheduledReminders.get(sessionId).stop();
    scheduledReminders.delete(sessionId);
    console.log(`Reminder cancelled for session ${sessionId}`);
  }
};

// PRODUCTION NOTE:
// ───────────────────────────────────────────────
// In-memory jobs → LOST on server restart/crash/redeploy.
// For production reliability:
//   - Store resumeAt in DB
//   - Run recurring cron (every 1-5 min) to find & process due sessions
