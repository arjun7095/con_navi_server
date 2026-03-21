const cron = require('node-cron');
const PostConflictSession = require('../models/PostConflictSession');
const LiveConflictSession = require('../models/LiveConflictSession');
const { sendPushToUser } = require('../controllers/notificationController');
const { CONFLICT_SESSION_STATUS } = require('./conflictSessionStatus');
const { buildSessionNotificationData } = require('./notificationRouting');

const QUICK_REMINDER_LIMIT = 3;
const QUICK_REMINDER_INTERVAL_MS = 5 * 60 * 1000;
const DAILY_REMINDER_HOUR = 10;
const DAILY_REMINDER_MINUTE = 0;

function getNextDayReminder(baseDate = new Date()) {
  const nextReminder = new Date(baseDate);
  nextReminder.setDate(nextReminder.getDate() + 1);
  nextReminder.setHours(DAILY_REMINDER_HOUR, DAILY_REMINDER_MINUTE, 0, 0);
  return nextReminder;
}

function buildInterruptionReminderState(baseDate = new Date()) {
  return {
    isActive: true,
    interruptedAt: baseDate,
    lastSentAt: null,
    quickReminderCount: 0,
    totalReminderCount: 0,
    nextReminderAt: new Date(baseDate.getTime() + QUICK_REMINDER_INTERVAL_MS),
  };
}

function clearInterruptionReminderState(session) {
  session.interruptionReminder = {
    isActive: false,
    interruptedAt: null,
    lastSentAt: null,
    quickReminderCount: 0,
    totalReminderCount: 0,
    nextReminderAt: null,
  };
}

async function processSessionReminder(session, conflictType) {
  const reminder = session.interruptionReminder;
  if (!reminder?.isActive || session.status !== CONFLICT_SESSION_STATUS.PAUSED) {
    return;
  }

  const title = 'Continue your conflict reflection';
  const body =
    reminder.quickReminderCount < QUICK_REMINDER_LIMIT
      ? 'You left a conflict session in progress. Come back when you can and continue where you stopped.'
      : 'Your unfinished conflict session is still waiting for you. Rejoin and continue your reflection.';

  const pushResult = await sendPushToUser(
    session.userId,
    title,
    body,
    buildSessionNotificationData(session, conflictType, {
      type: 'conflict_resume_reminder',
      notificationContext: 'interrupted_session',
    })
  );

  if (pushResult.successCount <= 0) {
    return;
  }

  const now = new Date();
  reminder.lastSentAt = now;
  reminder.totalReminderCount += 1;

  if (reminder.quickReminderCount < QUICK_REMINDER_LIMIT) {
    reminder.quickReminderCount += 1;
  }

  reminder.nextReminderAt =
    reminder.quickReminderCount < QUICK_REMINDER_LIMIT
      ? new Date(now.getTime() + QUICK_REMINDER_INTERVAL_MS)
      : getNextDayReminder(now);

  await session.save();
}

async function processDueReminders(Model, conflictType) {
  const now = new Date();
  const sessions = await Model.find({
    status: CONFLICT_SESSION_STATUS.PAUSED,
    'interruptionReminder.isActive': true,
    'interruptionReminder.nextReminderAt': { $lte: now },
  });

  for (const session of sessions) {
    try {
      await processSessionReminder(session, conflictType);
    } catch (error) {
      console.error(`Interrupted reminder error for ${conflictType} session ${session._id}:`, error);
    }
  }
}

const startInterruptedConflictReminder = () => {
  cron.schedule(
    '* * * * *',
    async () => {
      await processDueReminders(PostConflictSession, 'post');
      await processDueReminders(LiveConflictSession, 'live');
    },
    {
      scheduled: true,
      timezone: 'Asia/Kolkata',
    }
  );
};

module.exports = {
  QUICK_REMINDER_LIMIT,
  buildInterruptionReminderState,
  clearInterruptionReminderState,
  getNextDayReminder,
  startInterruptedConflictReminder,
};
