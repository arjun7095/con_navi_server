// src/controllers/notificationController.js
const { getMessaging } = require('firebase-admin/messaging');
const User = require('../models/User');
const { serializeNotificationData } = require('../utils/notificationRouting');

const messaging = getMessaging();

/**
 * Send push notification to a user
 * @param {string} userId
 * @param {string} title
 * @param {string} body
 * @param {object} [data={}]
 * @param {boolean} [dryRun=false]
 * @returns {Promise<{successCount: number, failureCount: number, failedTokensCount: number}>}
 */
const sendPushToUser = async (userId, title, body, data = {}, dryRun = false) => {
  try {
    const user = await User.findById(userId).select('fcmTokens');
    if (!user || !user.fcmTokens?.length) {
      console.log(`No FCM tokens for user ${userId}`);
      return { successCount: 0, failureCount: 0, failedTokensCount: 0, message: 'No tokens' };
    }
    const message = {
      notification: { title, body },
      data: serializeNotificationData(data),
      tokens: user.fcmTokens,
      android: { priority: 'high' },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default' } },
      },
    };

    // FIXED: pass dryRun directly as boolean (not { dryRun })
    const response = await messaging.sendEachForMulticast(message, dryRun);

    console.log(
      `FCM multicast to user ${userId} (${dryRun ? 'DRY RUN' : 'LIVE'}): ` +
      `${response.successCount} success / ${response.failureCount} failed`
    );

    // Clean up invalid tokens
    const failedTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const err = resp.error;
        const code = err?.code || 'unknown';
        const msg = err?.message || 'no message';

        console.warn(
          `FCM token #${idx} failed for user ${userId}: ` +
          `code=${code}, msg=${msg}, token=${user.fcmTokens[idx]?.substring(0, 12) || '??'}...`
        );

        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-unsupported' ||
          code === 'messaging/device-message-rate-exceeded' ||
          (code === 'messaging/unknown-error' && msg?.toLowerCase().includes('not-registered'))
        ) {
          failedTokens.push(user.fcmTokens[idx]);
        }
      }
    });

    let failedTokensCount = 0;
    if (failedTokens.length > 0) {
      user.fcmTokens = user.fcmTokens.filter(t => !failedTokens.includes(t));
      await user.save();
      console.log(`Removed ${failedTokens.length} invalid FCM tokens for user ${userId}`);
      failedTokensCount = failedTokens.length;
    }

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      failedTokensCount,
    };
  } catch (error) {
    console.error(`Error sending push to user ${userId}:`, error);
    return { successCount: 0, failureCount: 1, failedTokensCount: 0, error: error.message };
  }
};

module.exports = { sendPushToUser };
