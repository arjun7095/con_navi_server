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

function getCalendarDayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getDaysSinceInterrupted(interruptedAt, now = new Date()) {
  const interruptedDayStart = new Date(interruptedAt);
  interruptedDayStart.setHours(0, 0, 0, 0);

  const currentDayStart = new Date(now);
  currentDayStart.setHours(0, 0, 0, 0);

  return Math.floor((currentDayStart - interruptedDayStart) / (24 * 60 * 60 * 1000));
}

function getNextDayReminder(baseDate = new Date()) {
  const nextReminder = new Date(baseDate);
  nextReminder.setDate(nextReminder.getDate() + 1);
  nextReminder.setHours(DAILY_REMINDER_HOUR, DAILY_REMINDER_MINUTE, 0, 0);
  return nextReminder;
}

function getReminderContent(reminder, now = new Date()) {
  const daysSinceInterrupted = getDaysSinceInterrupted(reminder.interruptedAt, now);

  if (daysSinceInterrupted <= 0 && reminder.quickReminderCount < QUICK_REMINDER_LIMIT) {
    return {
      title: 'You have an unresolved conflict',
      body: 'You left a conflict unresolved. Do you want to continue now?',
    };
  }

  if (daysSinceInterrupted === 1) {
    return {
      title: 'Don’t leave this unresolved',
      body: 'You still have a conflict waiting. Take a moment to continue or reschedule.',
    };
  }

  return {
    title: 'This conflict is still unresolved',
    body: 'This hasn’t been resolved yet. Let’s come back and move it forward.',
  };
}

function getNextReminderAt(reminder, now = new Date()) {
  const interruptedAt = reminder.interruptedAt ? new Date(reminder.interruptedAt) : now;
  const daysSinceInterrupted = getDaysSinceInterrupted(interruptedAt, now);
  const nextQuickReminder = new Date(now.getTime() + QUICK_REMINDER_INTERVAL_MS);
  const isStillInterruptionDay =
    getCalendarDayKey(interruptedAt) === getCalendarDayKey(nextQuickReminder);

  if (
    daysSinceInterrupted <= 0 &&
    reminder.quickReminderCount < QUICK_REMINDER_LIMIT &&
    isStillInterruptionDay
  ) {
    return nextQuickReminder;
  }

  return getNextDayReminder(now);
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

  const now = new Date();
  const { title, body } = getReminderContent(reminder, now);

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

  reminder.lastSentAt = now;
  reminder.totalReminderCount += 1;

  if (getDaysSinceInterrupted(reminder.interruptedAt, now) <= 0 && reminder.quickReminderCount < QUICK_REMINDER_LIMIT) {
    reminder.quickReminderCount += 1;
  }

  reminder.nextReminderAt = getNextReminderAt(reminder, now);

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
  getDaysSinceInterrupted,
  startInterruptedConflictReminder,
};
