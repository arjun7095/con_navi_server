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
    if (isNaN(resumeDate.getTime())) {
      console.warn(`Invalid resume time for session ${sessionId} – skipping`);
      return;
    }

    const now = new Date();
    if (resumeDate <= now) {
      console.warn(`Resume time ${resumeDate.toISOString()} is in the past or now for session ${sessionId} – skipping schedule`);
      return;
    }

    // Optional: avoid scheduling too close (e.g. < 30 seconds) → could miss due to delay
    if ((resumeDate - now) < 30_000) {
      console.warn(`Resume time too soon (${resumeDate.toISOString()}) for session ${sessionId} – consider sending immediately instead`);
      // You could optionally call sendPushToUser() here instead
      return;
    }

    // Cancel any existing reminder for this session
    if (scheduledReminders.has(sessionId)) {
      scheduledReminders.get(sessionId).stop();
      scheduledReminders.delete(sessionId);
      console.log(`Existing reminder cancelled for session ${sessionId}`);
    }

    // Round UP to next minute if seconds present → avoids node-cron missing exact second
    let targetDate = new Date(resumeDate);
    if (targetDate.getSeconds() > 0 || targetDate.getMilliseconds() > 0) {
      targetDate.setMinutes(targetDate.getMinutes() + 1);
      targetDate.setSeconds(0);
      targetDate.setMilliseconds(0);
      console.log(`Rounded resume time from ${resumeDate.toISOString()} → ${targetDate.toISOString()} (to avoid node-cron second-precision issues)`);
    }

    // node-cron format: second minute hour day month day-of-week
    // We force second = 0 for reliability
    const cronExpression = `0 ${targetDate.getMinutes()} ${targetDate.getHours()} ${targetDate.getDate()} ${targetDate.getMonth() + 1} *`;

    console.log(`Scheduling reminder for session ${sessionId} at ${targetDate.toISOString()} (server time)`);

    const job = cron.schedule(
      cronExpression,
      async () => {
        console.log(`[CRON FIRED] ${new Date().toISOString()} – checking session ${sessionId}`);

        try {
          const session = await LiveConflictSession.findById(sessionId);
          if (!session) {
            console.log(`Session ${sessionId} not found – skipping reminder`);
            return;
          }

          if (session.status !== 'paused') {
            console.log(`Session ${sessionId} no longer paused (status: ${session.status}) – skipping reminder`);
            return;
          }

          console.log(`Sending resume push → user ${userId}, session ${sessionId}`);
          await sendPushToUser(userId, 'Resume Reminder', message);

          // Clear resumeAt so we don't accidentally re-trigger
          session.resumeAt = null;
          await session.save();

          console.log(`Resume reminder sent successfully for session ${sessionId} to user ${userId}`);
        } catch (err) {
          console.error(`[CRON ERROR] Failed to process reminder for session ${sessionId}:`, err);
        } finally {
          // Always clean up
          scheduledReminders.delete(sessionId);
          console.log(`Cleaned up scheduled job for session ${sessionId}`);
        }
      },
      {
        scheduled: true,
        timezone: 'Asia/Kolkata'   // Explicit IST – recommended if server might run in different TZ
      }
    );

    scheduledReminders.set(sessionId, job);

    console.log(`Reminder successfully scheduled for session ${sessionId} at ~${targetDate.toISOString()}`);
  } catch (err) {
    console.error(`scheduleReminder error for session ${sessionId}:`, err);
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
  } else {
    console.log(`No scheduled reminder found to cancel for session ${sessionId}`);
  }
};

/**
 * IMPORTANT PRODUCTION NOTE:
 * ───────────────────────────────────────────────
 * These jobs live in memory → they are LOST if:
 *   • Server restarts
 *   • App crashes
 *   • Deployment / pod restart
 *   • Dyno sleeps (Heroku), etc.
 *
 * For reliable production reminders:
 *   1. Keep `resumeAt` in DB
 *   2. Run a single recurring cron every 1–5 minutes:
 *        → Find all paused sessions where resumeAt <= now()
 *        → Send notification + clear resumeAt
 *   3. Libraries like Agenda, BullMQ or node-cron + DB scanner work well.
 */