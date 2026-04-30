const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const {
  getAdminSelf,
  updateAdminSelf,
  deleteAdminSelf,
  getOverview,
  getUserList,
  getUserDetail,
  getTimeBasedAnalytics,
  getSessionAnalytics,
  getDurationAnalytics,
  sendNotificationToUser,
  sendMonthlyNotificationsToAll,
  sendEmailToUser,
  getMonthlyReportSettings,
  updateMonthlyReportSettings,
} = require('../controllers/adminController');

router.use(adminAuth);

router.get('/me', getAdminSelf);
router.put('/me', updateAdminSelf);
router.delete('/me', deleteAdminSelf);

router.get('/overview', getOverview);

router.get('/users', getUserList);
router.get('/users/:userId', getUserDetail);

router.get('/analytics/time', getTimeBasedAnalytics);
router.get('/analytics/sessions', getSessionAnalytics);
router.get('/analytics/duration', getDurationAnalytics);

router.get('/settings/monthly-report', getMonthlyReportSettings);
router.put('/settings/monthly-report', updateMonthlyReportSettings);

router.post('/notifications/send', sendNotificationToUser);
router.post('/notifications/monthly', sendMonthlyNotificationsToAll);

router.post('/email/send', sendEmailToUser);

module.exports = router;
