// src/controllers/notificationController.js
const { messaging } = require('../config/firebase');
const User = require('../models/User');

const sendPushToUser = async (userId, title, body, data = {}) => {
  try {
    const user = await User.findById(userId);
    if (!user || user.fcmTokens?.length === 0) {
      console.log(`No FCM tokens found for user ${userId}`);
      return;
    }

    const message = {
      notification: {
        title,
        body,
      },
      data, // optional extra data
      tokens: user.fcmTokens,
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } },
    };

    const response = await messaging.sendEachForMulticast(message);
    console.log(`Push sent to user ${userId}: ${response.successCount} successful, ${response.failureCount} failed`);

    // Clean up invalid tokens (good practice)
    const failedTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
        failedTokens.push(user.fcmTokens[idx]);
      }
    });

    if (failedTokens.length > 0) {
      user.fcmTokens = user.fcmTokens.filter(t => !failedTokens.includes(t));
      await user.save();
    }

  } catch (error) {
    console.error('Error sending push notification:', error);
  }
};

module.exports = { sendPushToUser };