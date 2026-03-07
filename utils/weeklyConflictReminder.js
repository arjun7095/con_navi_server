const cron = require('node-cron');
const mongoose = require('mongoose');

const User = require('../models/User');
const PostConflictSession = require('../models/PostConflictSession');
const LiveConflictSession = require('../models/LiveConflictSession');

const { sendPushToUser } = require('../controllers/notificationController');

const startWeeklyConflictReminder = () => {

  // Runs every Monday at 9 AM
  cron.schedule('* * * * *', async () => {

    console.log('Running weekly conflict reminder check...');

 try {

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const users = await User.find({
    fcmTokens: { $exists: true, $ne: [] }
  }).select('_id');

  for (const user of users) {

    const userId = new mongoose.Types.ObjectId(user._id);

    const postCount = await PostConflictSession.countDocuments({
      userId,
	status:'completed',
      createdAt: { $gte: oneWeekAgo }
    });

    const liveCount = await LiveConflictSession.countDocuments({
      userId,
	    status:'completed',
      startedAt: { $gte: oneWeekAgo }
    });

    const totalConflicts = postCount + liveCount;

    console.log(`User ${userId} -> Post:${postCount} Live:${liveCount}`);

    // Case 1: No conflicts in last week
    if (totalConflicts === 0) {

      await sendPushToUser(
        userId,
        "Are you dealing with a conflict?",
        "You can resolve it by interacting with me. Start here.",
        { type: "conflict_start" }
      );

      console.log("Sent start conflict reminder to:", userId);
    }

    // Case 2: Conflicts exist → Ask to review trends
    else {

      await sendPushToUser(
        userId,
        "Review your conflict trends",
        "You had conflict sessions last week. Check your emotional trends and insights.",
        { type: "review_trends" }
      );

      console.log("Sent trends review reminder to:", userId);
    }

  }

    } catch (error) {

      console.error("Weekly conflict reminder error:", error);

    }

  });

};

module.exports = startWeeklyConflictReminder;
