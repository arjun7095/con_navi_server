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
  sendNotificationToUser,
  sendMonthlyNotificationsToAll,
  sendEmailToUser,
} = require('../controllers/adminController');

// All admin routes require a valid admin JWT
router.use(adminAuth);

// GET /api/admin/me
// Return the authenticated admin's own account details
router.get('/me', getAdminSelf);

// PUT /api/admin/me
// Update the authenticated admin's own account details
router.put('/me', updateAdminSelf);

// DELETE /api/admin/me
// Delete the authenticated admin's own account
router.delete('/me', deleteAdminSelf);

// ── Dashboard ──────────────────────────────────────────────────────────────────
// GET /api/admin/overview
// Returns total users, active users, session counts by status
router.get('/overview', getOverview);

// ── User Management ────────────────────────────────────────────────────────────
// GET /api/admin/users?search=&page=&limit=&profileComplete=&sortBy=
// List all users with optional search, pagination, filters
router.get('/users', getUserList);

// GET /api/admin/users/:userId
// Full detail for a single user including their session stats
router.get('/users/:userId', getUserDetail);

// ── Analytics ──────────────────────────────────────────────────────────────────
// GET /api/admin/analytics/time?userId=&startDate=&endDate=&sessionType=live|post
// Busiest days, busiest hours, monthly usage trend
router.get('/analytics/time', getTimeBasedAnalytics);

// GET /api/admin/analytics/sessions?userId=&startDate=&endDate=&sessionType=live|post
// Session status breakdown, feelings, keywords from speaking/listening content
router.get('/analytics/sessions', getSessionAnalytics);

// ── Notifications ──────────────────────────────────────────────────────────────
// POST /api/admin/notifications/send
// Body: { userId, title, body, includeReport? }
// On-demand push notification to a specific user (optionally includes session report data)
router.post('/notifications/send', sendNotificationToUser);

// POST /api/admin/notifications/monthly
// Body: { title, bodyTemplate? }
// Send monthly stats notification to all users who have FCM tokens
// bodyTemplate supports placeholders: {name}, {total}, {completed}, {paused},
//   {liveSessions}, {postSessions}, {liveCompleted}, {postCompleted}
router.post('/notifications/monthly', sendMonthlyNotificationsToAll);

// ── Email ──────────────────────────────────────────────────────────────────────
// POST /api/admin/email/send
// Body: { userId, subject, message }
// Send a plain email (written by admin) to a specific user
router.post('/email/send', sendEmailToUser);

module.exports = router;
