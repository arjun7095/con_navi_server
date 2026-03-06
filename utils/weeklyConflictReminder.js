const cron = require('node-cron');
const mongoose = require('mongoose');

const User = require('../models/User');
const PostConflictSession = require('../models/PostConflictSession');
const LiveConflictSession = require('../models/LiveConflictSession');

const { sendPushToUser } = require('../controllers/notificationController');

const startWeeklyConflictReminder = () => {

  // Runs every Monday at 9 AM
  cron.schedule('0 9 * * 1', async () => {

    console.log('Running weekly conflict reminder check...');

    try {

      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      // Only users who have FCM tokens
      const users = await User.find({
        fcmTokens: { $exists: true, $ne: [] }
      }).select('_id');

      for (const user of users) {

        const userId = new mongoose.Types.ObjectId(user._id);

        const postCount = await PostConflictSession.countDocuments({
          userId,
          createdAt: { $gte: oneWeekAgo }
        });

        const liveCount = await LiveConflictSession.countDocuments({
          userId,
          createdAt: { $gte: oneWeekAgo }
        });

        const totalConflicts = postCount + liveCount;

        // If no conflicts in last 7 days → send reminder
        if (totalConflicts === 0) {

          await sendPushToUser(
            userId,
            "Are you dealing with a conflict?",
            "You can resolve it by interacting with me. Start here.",
            {
              type: "weekly_conflict_reminder"
            }
          );

          console.log(`Reminder sent to user ${userId}`);

        }

      }

    } catch (error) {

      console.error("Weekly conflict reminder error:", error);

    }

  });

};

module.exports = startWeeklyConflictReminder;