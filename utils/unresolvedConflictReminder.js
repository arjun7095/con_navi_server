const cron = require('node-cron');
const mongoose = require('mongoose');

const User = require('../models/User');
const PostConflictSession = require('../models/PostConflictSession');
const LiveConflictSession = require('../models/LiveConflictSession');
const { CONFLICT_SESSION_STATUS } = require('./conflictSessionStatus');
const { sendPushToUser } = require('../controllers/notificationController');
const { buildUnresolvedConflictsNotificationData } = require('./notificationRouting');

const WEEKLY_UNRESOLVED_TITLE = 'Conflicts need your attention';

function buildWeeklyUnresolvedMessage(totalUnresolvedConflicts) {
  return `You have ${totalUnresolvedConflicts} unresolved conflicts. Let’s work toward resolving them.`;
}

const startUnresolvedConflictReminder = () => {
  // Every Monday at 10:00 AM IST
  cron.schedule(
    '0 10 * * 1',
    async () => {
      console.log('Running unresolved conflict reminder check...');

      try {
        const users = await User.find({
          fcmTokens: { $exists: true, $ne: [] },
        }).select('_id');

        for (const user of users) {
          const userId = new mongoose.Types.ObjectId(user._id);

          const [postConflictCount, liveConflictCount] = await Promise.all([
            PostConflictSession.countDocuments({
              userId,
              status: { $ne: CONFLICT_SESSION_STATUS.COMPLETED },
            }),
            LiveConflictSession.countDocuments({
              userId,
              status: { $ne: CONFLICT_SESSION_STATUS.COMPLETED },
            }),
          ]);

          const totalUnresolvedConflicts = postConflictCount + liveConflictCount;

          if (totalUnresolvedConflicts <= 0) {
            continue;
          }

          await sendPushToUser(
            userId,
            WEEKLY_UNRESOLVED_TITLE,
            buildWeeklyUnresolvedMessage(totalUnresolvedConflicts),
            buildUnresolvedConflictsNotificationData({
              postConflictCount,
              liveConflictCount,
              extras: {
                routeTarget: 'unresolved_conflicts',
              },
            })
          );

          console.log(
            `Sent unresolved conflict reminder to ${userId}: ` +
            `post=${postConflictCount}, live=${liveConflictCount}, total=${totalUnresolvedConflicts}`
          );
        }
      } catch (error) {
        console.error('Unresolved conflict reminder error:', error);
      }
    },
    {
      scheduled: true,
      timezone: 'Asia/Kolkata',
    }
  );
};

module.exports = startUnresolvedConflictReminder;
