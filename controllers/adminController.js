const mongoose = require('mongoose');
const User = require('../models/User');
const LiveConflictSession = require('../models/LiveConflictSession');
const PostConflictSession = require('../models/PostConflictSession');
const AdminSettings = require('../models/AdminSettings');
const { sendPushToUser } = require('./notificationController');
const { sendEmail } = require('../utils/emailService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE64_IMAGE_REGEX = /^[A-Za-z0-9+/=]+$/;
const IMAGE_DATA_URI_REGEX = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/;
const DEFAULT_MONTHLY_REPORT_TITLE = 'Your I Feel Heard Monthly Trend Report';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us',
  'them', 'my', 'your', 'his', 'its', 'our', 'their', 'what', 'which', 'who',
  'when', 'where', 'why', 'how', 'not', 'no', 'so', 'if', 'as', 'up', 'out',
]);

function extractKeywords(texts, topN = 20) {
  const wordCount = {};
  for (const text of texts) {
    if (!text || typeof text !== 'string') continue;
    const words = text.toLowerCase().replace(/[^a-z\s'-]/g, '').split(/\s+/);
    for (const word of words) {
      const clean = word.replace(/^['-]+|['-]+$/g, '').trim();
      if (clean.length < 3) continue;
      if (STOP_WORDS.has(clean)) continue;
      wordCount[clean] = (wordCount[clean] || 0) + 1;
    }
  }
  return Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

function sortByCount(obj) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([value, count]) => ({ value, count }));
}

function buildStatusStats(sessions) {
  return {
    total: sessions.length,
    completed: sessions.filter(s => s.status === 'completed').length,
    paused: sessions.filter(s => s.status === 'paused').length,
    abandoned: sessions.filter(s => s.status === 'abandoned').length,
    active: sessions.filter(s => s.status === 'active').length,
  };
}

function buildDateFilter(startDate, endDate) {
  if (!startDate && !endDate) return {};
  const filter = { createdAt: {} };
  if (startDate) filter.createdAt.$gte = new Date(startDate);
  if (endDate) filter.createdAt.$lte = new Date(endDate);
  return filter;
}

function buildAdminProfile(admin) {
  return {
    userId: admin._id.toString(),
    countryCode: admin.countryCode,
    mobile: admin.mobile,
    role: admin.role,
    name: admin.name,
    email: admin.email,
    avatar: admin.avatar,
    profileImageUrl: admin.profileImageUrl,
    notificationPreference: admin.notificationPreference,
    dataAnalyticsEnabled: admin.dataAnalyticsEnabled,
    isProfileComplete: admin.isProfileComplete,
    lastLogin: admin.lastLogin,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}

function calculateProfileCompleteness(user) {
  return !!(
    user.name && user.email && (user.avatar || user.profileImageUrl) && user.notificationPreference
  );
}

function isValidImageValue(value) {
  if (typeof value !== 'string') return false;
  const trimmedValue = value.trim();
  if (!trimmedValue) return false;
  try {
    const parsedUrl = new URL(trimmedValue);
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') return true;
  } catch (_) {}
  if (IMAGE_DATA_URI_REGEX.test(trimmedValue)) return true;
  return BASE64_IMAGE_REGEX.test(trimmedValue) && trimmedValue.length >= 20;
}

function countListValues(counter, values) {
  (values || []).forEach(v => {
    if (!v || typeof v !== 'string') return;
    const key = v.trim().toLowerCase();
    if (!key) return;
    counter[key] = (counter[key] || 0) + 1;
  });
}

function formatMonthKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

async function buildDetailedSessionNotificationData(userId) {
  const [liveSessions, postSessions] = await Promise.all([
    LiveConflictSession.find({ userId }).sort({ createdAt: -1 }).lean(),
    PostConflictSession.find({ userId }).sort({ createdAt: -1 }).lean(),
  ]);

  return {
    type: 'admin_report_detailed',
    live_session_count: String(liveSessions.length),
    post_session_count: String(postSessions.length),
    live_sessions: JSON.stringify(liveSessions),
    post_sessions: JSON.stringify(postSessions),
  };
}

async function getOrCreateAdminSettings() {
  let settings = await AdminSettings.findOne({ key: 'default' });
  if (!settings) {
    settings = await AdminSettings.create({
      key: 'default',
      monthlyReport: {
        autoSendEnabled: false,
        title: DEFAULT_MONTHLY_REPORT_TITLE,
        bodyTemplate: '',
        sendPush: true,
        sendEmail: true,
      },
    });
  }
  return settings;
}

async function dispatchMonthlyReports({ title, bodyTemplate, sendPush = true, sendEmail = true }) {
  const finalTitle = title || DEFAULT_MONTHLY_REPORT_TITLE;
  const now = new Date();
  const firstOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59));

  const users = await User.find({ role: 'user' }).select('_id name email fcmTokens');

  let pushSuccessCount = 0;
  let pushFailureCount = 0;
  let emailSuccessCount = 0;
  let emailFailureCount = 0;

  for (const user of users) {
    const [liveTotal, postTotal, liveCompleted, postCompleted, livePaused, postPaused, liveAbandoned, postAbandoned] =
      await Promise.all([
        LiveConflictSession.countDocuments({ userId: user._id, createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth } }),
        PostConflictSession.countDocuments({ userId: user._id, createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth } }),
        LiveConflictSession.countDocuments({ userId: user._id, status: 'completed', createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth } }),
        PostConflictSession.countDocuments({ userId: user._id, status: 'completed', createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth } }),
        LiveConflictSession.countDocuments({ userId: user._id, status: 'paused', createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth } }),
        PostConflictSession.countDocuments({ userId: user._id, status: 'paused', createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth } }),
        LiveConflictSession.countDocuments({ userId: user._id, status: 'abandoned', createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth } }),
        PostConflictSession.countDocuments({ userId: user._id, status: 'abandoned', createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth } }),
      ]);

    const totalSessions = liveTotal + postTotal;
    const totalCompleted = liveCompleted + postCompleted;
    const totalPaused = livePaused + postPaused;
    const totalUnresolved = liveAbandoned + postAbandoned;
    const userName = user.name || 'there';

    const reportBody = bodyTemplate
      ? bodyTemplate
          .replace('{name}', userName)
          .replace('{total}', totalSessions)
          .replace('{completed}', totalCompleted)
          .replace('{paused}', totalPaused)
          .replace('{unresolved}', totalUnresolved)
          .replace('{liveSessions}', liveTotal)
          .replace('{postSessions}', postTotal)
          .replace('{liveCompleted}', liveCompleted)
          .replace('{postCompleted}', postCompleted)
      : `Hi ${userName}! Your monthly summary: ${totalSessions} session(s) started, ${totalCompleted} completed, ${totalPaused} paused, ${totalUnresolved} unresolved.`;

    if (sendPush && Array.isArray(user.fcmTokens) && user.fcmTokens.length) {
      const pushData = {
        type: 'monthly_report',
        live_total: String(liveTotal),
        post_total: String(postTotal),
        live_completed: String(liveCompleted),
        post_completed: String(postCompleted),
        live_paused: String(livePaused),
        post_paused: String(postPaused),
        live_abandoned: String(liveAbandoned),
        post_abandoned: String(postAbandoned),
      };

      const pushResult = await sendPushToUser(user._id.toString(), finalTitle, reportBody, pushData);
      if (pushResult.successCount > 0) pushSuccessCount += 1;
      else pushFailureCount += 1;
    }

    if (sendEmail && user.email) {
      try {
        await sendEmail({ to: user.email, subject: finalTitle, text: reportBody });
        emailSuccessCount += 1;
      } catch (_) {
        emailFailureCount += 1;
      }
    }
  }

  return {
    title: finalTitle,
    period: {
      startDate: firstOfPrevMonth,
      endDate: lastOfPrevMonth,
      monthKey: formatMonthKey(firstOfPrevMonth),
    },
    summary: {
      totalUsers: users.length,
      push: { enabled: !!sendPush, successCount: pushSuccessCount, failureCount: pushFailureCount },
      email: { enabled: !!sendEmail, successCount: emailSuccessCount, failureCount: emailFailureCount },
    },
  };
}

exports.runAutomatedMonthlyReportDispatch = async () => {
  const settings = await getOrCreateAdminSettings();
  if (!settings.monthlyReport?.autoSendEnabled) return { skipped: true, reason: 'auto_send_disabled' };

  const now = new Date();
  const targetMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const targetMonthKey = formatMonthKey(targetMonthDate);

  if (settings.monthlyReport.lastRunForMonth === targetMonthKey) {
    return { skipped: true, reason: 'already_ran_for_month', monthKey: targetMonthKey };
  }

  const result = await dispatchMonthlyReports({
    title: settings.monthlyReport.title,
    bodyTemplate: settings.monthlyReport.bodyTemplate,
    sendPush: settings.monthlyReport.sendPush,
    sendEmail: settings.monthlyReport.sendEmail,
  });

  settings.monthlyReport.lastRunForMonth = targetMonthKey;
  settings.monthlyReport.lastRunAt = new Date();
  await settings.save();

  return { skipped: false, ...result };
};

exports.getAdminSelf = async (req, res) => {
  try {
    const admin = await User.findOne({ _id: req.user.userId, role: 'admin' }).select('-refreshTokens -fcmTokens');
    if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });
    return res.json({ success: true, data: { admin: buildAdminProfile(admin) } });
  } catch (err) {
    console.error('getAdminSelf error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateAdminSelf = async (req, res) => {
  try {
    const allowedFields = ['name', 'email', 'avatar', 'profileImageUrl', 'notificationPreference', 'dataAnalyticsEnabled'];
    const updates = {};
    allowedFields.forEach(field => { if (req.body[field] !== undefined) updates[field] = req.body[field]; });

    if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: 'Provide at least one valid field to update' });

    if (updates.name !== undefined) {
      if (typeof updates.name !== 'string' || !updates.name.trim()) return res.status(400).json({ success: false, message: 'name must be a non-empty string' });
      updates.name = updates.name.trim();
    }

    if (updates.email !== undefined) {
      if (typeof updates.email !== 'string') return res.status(400).json({ success: false, message: 'email must be a string' });
      updates.email = updates.email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(updates.email)) return res.status(400).json({ success: false, message: 'Invalid email address' });
    }

    if (updates.notificationPreference !== undefined && !['all', 'important', 'none'].includes(updates.notificationPreference)) {
      return res.status(400).json({ success: false, message: 'Invalid notificationPreference value' });
    }

    if (updates.dataAnalyticsEnabled !== undefined && typeof updates.dataAnalyticsEnabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'dataAnalyticsEnabled must be a boolean' });
    }

    if (updates.avatar !== undefined && !isValidImageValue(updates.avatar)) return res.status(400).json({ success: false, message: 'avatar must be a valid image URL or base64 string' });
    if (updates.profileImageUrl !== undefined && !isValidImageValue(updates.profileImageUrl)) return res.status(400).json({ success: false, message: 'profileImageUrl must be a valid image URL or base64 string' });

    const admin = await User.findOne({ _id: req.user.userId, role: 'admin' });
    if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });

    Object.assign(admin, updates);
    admin.isProfileComplete = calculateProfileCompleteness(admin);
    await admin.save();

    return res.json({ success: true, message: 'Admin details updated successfully', data: { admin: buildAdminProfile(admin) } });
  } catch (err) {
    console.error('updateAdminSelf error:', err);
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Duplicate value (for example email already exists)' });
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.deleteAdminSelf = async (req, res) => {
  try {
    const admin = await User.findOne({ _id: req.user.userId, role: 'admin' }).select('_id');
    if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });

    await Promise.all([
      User.deleteOne({ _id: admin._id }),
      LiveConflictSession.deleteMany({ userId: admin._id }),
      PostConflictSession.deleteMany({ userId: admin._id }),
    ]);

    return res.json({ success: true, message: 'Admin account deleted successfully' });
  } catch (err) {
    console.error('deleteAdminSelf error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getOverview = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const sessionDateFilter = buildDateFilter(startDate, endDate);
    const liveFilter = { ...sessionDateFilter };
    const postFilter = { ...sessionDateFilter };

    const [
      totalUsers,
      activeUsers,
      totalLive,
      totalPost,
      completedLive,
      completedPost,
      pausedLive,
      pausedPost,
      abandonedLive,
      abandonedPost,
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', lastLogin: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
      LiveConflictSession.countDocuments(liveFilter),
      PostConflictSession.countDocuments(postFilter),
      LiveConflictSession.countDocuments({ ...liveFilter, status: 'completed' }),
      PostConflictSession.countDocuments({ ...postFilter, status: 'completed' }),
      LiveConflictSession.countDocuments({ ...liveFilter, status: 'paused' }),
      PostConflictSession.countDocuments({ ...postFilter, status: 'paused' }),
      LiveConflictSession.countDocuments({ ...liveFilter, status: 'abandoned' }),
      PostConflictSession.countDocuments({ ...postFilter, status: 'abandoned' }),
    ]);

    return res.json({
      success: true,
      data: {
        users: { total: totalUsers, activeLast30Days: activeUsers, inactive: totalUsers - activeUsers },
        sessions: {
          live: { total: totalLive, completed: completedLive, paused: pausedLive, abandoned: abandonedLive },
          post: { total: totalPost, completed: completedPost, paused: pausedPost, abandoned: abandonedPost },
          combined: {
            total: totalLive + totalPost,
            completed: completedLive + completedPost,
            paused: pausedLive + pausedPost,
            abandoned: abandonedLive + abandonedPost,
          },
        },
        filters: { startDate: startDate || null, endDate: endDate || null },
      },
    });
  } catch (err) {
    console.error('getOverview error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getUserList = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20, profileComplete, sortBy = 'lastLogin' } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const filter = { role: { $ne: 'admin' } };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    if (profileComplete !== undefined) filter.isProfileComplete = profileComplete === 'true';

    const sortOptions = sortBy === 'createdAt' ? { createdAt: -1 } : { lastLogin: -1 };

    const [users, total] = await Promise.all([
      User.find(filter).select('name mobile email avatar role isProfileComplete lastLogin createdAt').sort(sortOptions).skip(skip).limit(parseInt(limit, 10)),
      User.countDocuments(filter),
    ]);

    return res.json({ success: true, data: { users, total, page: parseInt(page, 10), limit: parseInt(limit, 10), pages: Math.ceil(total / parseInt(limit, 10)) } });
  } catch (err) {
    console.error('getUserList error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getUserDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;
    const user = await User.findById(userId).select('-refreshTokens -fcmTokens');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const dateFilter = buildDateFilter(startDate, endDate);
    const liveFilter = { userId, ...dateFilter };
    const postFilter = { userId, ...dateFilter };

    const [liveSessions, postSessions] = await Promise.all([
      LiveConflictSession.find(liveFilter).sort({ createdAt: -1 }),
      PostConflictSession.find(postFilter).sort({ createdAt: -1 }),
    ]);

    return res.json({
      success: true,
      data: {
        user,
        sessionStats: {
          live: buildStatusStats(liveSessions),
          post: buildStatusStats(postSessions),
          combined: buildStatusStats([...liveSessions, ...postSessions]),
        },
        totalSessions: liveSessions.length + postSessions.length,
        allLiveSessions: liveSessions,
        allPostSessions: postSessions,
        filters: { startDate: startDate || null, endDate: endDate || null },
      },
    });
  } catch (err) {
    console.error('getUserDetail error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getTimeBasedAnalytics = async (req, res) => {
  try {
    const { userId, startDate, endDate, sessionType } = req.query;

    const matchFilter = { ...buildDateFilter(startDate, endDate) };
    if (userId) matchFilter.userId = new mongoose.Types.ObjectId(userId);

    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const pipeline = [
      { $match: matchFilter },
      {
        $facet: {
          byDayOfWeek: [{ $group: { _id: { $dayOfWeek: '$createdAt' }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
          byHour: [{ $group: { _id: { $hour: '$createdAt' }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
          byMonth: [{ $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { '_id.year': 1, '_id.month': 1 } }],
          total: [{ $count: 'count' }],
        },
      },
    ];

    const formatResult = ([facet]) => ({
      busiestDays: (facet?.byDayOfWeek || []).map(d => ({ day: DAY_NAMES[d._id - 1] || 'Unknown', count: d.count })),
      busiestHours: (facet?.byHour || []).map(d => ({ hour: d._id, label: `${String(d._id).padStart(2, '0')}:00`, count: d.count })),
      monthlyTrend: (facet?.byMonth || []).map(d => ({ year: d._id.year, month: d._id.month, count: d.count })),
      total: facet?.total[0]?.count || 0,
    });

    const results = {};
    if (!sessionType || sessionType === 'live') results.live = formatResult(await LiveConflictSession.aggregate(pipeline));
    if (!sessionType || sessionType === 'post') results.post = formatResult(await PostConflictSession.aggregate(pipeline));

    return res.json({ success: true, data: results });
  } catch (err) {
    console.error('getTimeBasedAnalytics error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getSessionAnalytics = async (req, res) => {
  try {
    const { userId, startDate, endDate, sessionType } = req.query;

    const matchFilter = { ...buildDateFilter(startDate, endDate) };
    if (userId) matchFilter.userId = new mongoose.Types.ObjectId(userId);

    const results = {};

    if (!sessionType || sessionType === 'live') {
      const liveSessions = await LiveConflictSession.find(matchFilter);
      const presentFeelings = {};
      const desiredFeelings = {};
      const needs = {};
      const speakingTexts = [];
      const listeningTexts = [];

      for (const session of liveSessions) {
        countListValues(presentFeelings, session.presentFeelings);
        countListValues(desiredFeelings, session.desiredFeelings);

        (session.conversationCycles || []).forEach(cycle => {
          const sp = cycle.speaking;
          if (sp) {
            speakingTexts.push(sp.experience, sp.assumptions, sp.when, sp.request, ...(sp.structuredStatements || []));
            countListValues(needs, sp.needs || []);
          }
          if (cycle.listening) {
            listeningTexts.push(...(cycle.listening.communicated || []));
            countListValues(needs, cycle.listening.needs || []);
          }
        });
      }

      results.live = {
        statusBreakdown: buildStatusStats(liveSessions),
        feelings: { present: sortByCount(presentFeelings), desired: sortByCount(desiredFeelings) },
        needs: sortByCount(needs),
        keywords: {
          speaking: extractKeywords(speakingTexts.filter(Boolean)),
          listening: extractKeywords(listeningTexts.filter(Boolean)),
          combined: extractKeywords([...speakingTexts, ...listeningTexts].filter(Boolean)),
        },
      };
    }

    if (!sessionType || sessionType === 'post') {
      const postSessions = await PostConflictSession.find(matchFilter);
      const presentFeelings = {};
      const desiredFeelings = {};
      const needs = {};
      const step3Texts = [];

      for (const session of postSessions) {
        countListValues(presentFeelings, session.step2?.presentFeelings);
        countListValues(desiredFeelings, session.step2?.desiredFeelings);
        countListValues(needs, session.step2?.presentNeeds);
        countListValues(needs, session.step2?.desiredNeeds);

        const s3 = session.step3;
        if (s3) {
          step3Texts.push(s3.experience, s3.react, s3.assumption, s3.thoughts, s3.understanding, ...(s3.terms || []).map(t => `${t.option} ${t.description}`));
        }
      }

      results.post = {
        statusBreakdown: buildStatusStats(postSessions),
        feelings: { present: sortByCount(presentFeelings), desired: sortByCount(desiredFeelings) },
        needs: sortByCount(needs),
        keywords: extractKeywords(step3Texts.filter(Boolean)),
      };
    }

    return res.json({ success: true, data: results });
  } catch (err) {
    console.error('getSessionAnalytics error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getDurationAnalytics = async (req, res) => {
  try {
    const { userId, startDate, endDate, sessionType } = req.query;
    const dateFilter = buildDateFilter(startDate, endDate);

    const buildLiveFilter = extra => ({ ...dateFilter, ...extra });
    const buildPostFilter = extra => ({ ...dateFilter, ...extra });

    const computeAverages = sessions => {
      const durations = sessions.map(s => s.totalDurationMinutes || (s.startedAt && s.completedAt ? Math.round((new Date(s.completedAt) - new Date(s.startedAt)) / 60000) : null)).filter(v => typeof v === 'number' && v >= 0);
      const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
      return { averageMinutes: avg, countWithDuration: durations.length };
    };

    const responseData = {};

    if (!sessionType || sessionType === 'live') {
      const globalLive = await LiveConflictSession.find(buildLiveFilter({ status: 'completed' }));
      const userLive = userId ? await LiveConflictSession.find(buildLiveFilter({ userId, status: 'completed' })) : globalLive;

      const userDurations = userLive.map(s => ({ sessionId: s._id, startedAt: s.startedAt, completedAt: s.completedAt, totalDurationMinutes: s.totalDurationMinutes || null, currentStep: s.currentStep, status: s.status }));

      const stepCounters = {};
      userLive.forEach(s => {
        const cycles = s.conversationCycles || [];
        if (cycles.length) stepCounters['conversation_cycle_count'] = (stepCounters['conversation_cycle_count'] || 0) + cycles.length;
      });

      responseData.live = {
        overallAverageMinutes: computeAverages(globalLive).averageMinutes,
        userAverageMinutes: computeAverages(userLive).averageMinutes,
        totalCompletedSessionsConsidered: userLive.length,
        sessions: userDurations,
        stepDurationInsights: Object.entries(stepCounters).map(([step, count]) => ({ step, value: count })),
      };
    }

    if (!sessionType || sessionType === 'post') {
      const globalPost = await PostConflictSession.find(buildPostFilter({ status: 'completed' }));
      const userPost = userId ? await PostConflictSession.find(buildPostFilter({ userId, status: 'completed' })) : globalPost;

      const toDuration = s => (s.startedAt && s.completedAt ? Math.round((new Date(s.completedAt) - new Date(s.startedAt)) / 60000) : null);

      responseData.post = {
        overallAverageMinutes: computeAverages(globalPost).averageMinutes,
        userAverageMinutes: computeAverages(userPost).averageMinutes,
        totalCompletedSessionsConsidered: userPost.length,
        sessions: userPost.map(s => ({ sessionId: s._id, startedAt: s.startedAt, completedAt: s.completedAt, totalDurationMinutes: toDuration(s), status: s.status })),
      };
    }

    return res.json({ success: true, data: responseData, filters: { userId: userId || null, startDate: startDate || null, endDate: endDate || null, sessionType: sessionType || null } });
  } catch (err) {
    console.error('getDurationAnalytics error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.sendNotificationToUser = async (req, res) => {
  try {
    const { userId, audience, title, body, includeReport = false } = req.body;
    if (!title || !body) return res.status(400).json({ success: false, message: 'title and body are required' });

    const isBroadcast = audience === 'all' || userId === 'all';

    if (isBroadcast) {
      const users = await User.find({ role: 'user' }).select('_id');
      let successCount = 0;
      let failureCount = 0;

      for (const user of users) {
        const notificationData = includeReport
          ? await buildDetailedSessionNotificationData(user._id)
          : { type: 'admin_notification' };
        const result = await sendPushToUser(user._id.toString(), title, body, notificationData);
        if (result.successCount > 0) successCount += 1;
        else failureCount += 1;
      }

      return res.json({ success: true, message: 'Broadcast notification sent', result: { audience: 'all', totalUsers: users.length, successCount, failureCount } });
    }

    if (!userId) return res.status(400).json({ success: false, message: 'userId is required when audience is not all' });
    const user = await User.findById(userId).select('name email fcmTokens');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const notificationData = includeReport
      ? await buildDetailedSessionNotificationData(userId)
      : { type: 'admin_notification' };

    const result = await sendPushToUser(userId, title, body, notificationData);
    return res.json({ success: true, message: 'Notification sent', result });
  } catch (err) {
    console.error('sendNotificationToUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.sendMonthlyNotificationsToAll = async (req, res) => {
  try {
    const { title = DEFAULT_MONTHLY_REPORT_TITLE, bodyTemplate = '', sendPush = true, sendEmail = true } = req.body;
    const result = await dispatchMonthlyReports({ title, bodyTemplate, sendPush, sendEmail });
    return res.json({ success: true, message: `Monthly reports dispatched to ${result.summary.totalUsers} users`, ...result });
  } catch (err) {
    console.error('sendMonthlyNotificationsToAll error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.sendEmailToUser = async (req, res) => {
  try {
    const { userId, audience, subject, message } = req.body;
    if (!subject || !message) return res.status(400).json({ success: false, message: 'subject and message are required' });

    const isBroadcast = audience === 'all' || userId === 'all';

    if (isBroadcast) {
      const users = await User.find({ role: 'user', email: { $exists: true, $ne: '' } }).select('email');
      let successCount = 0;
      let failureCount = 0;

      for (const user of users) {
        try {
          await sendEmail({ to: user.email, subject, text: message });
          successCount += 1;
        } catch (_) {
          failureCount += 1;
        }
      }

      return res.json({ success: true, message: 'Broadcast email sent', result: { audience: 'all', totalUsers: users.length, successCount, failureCount } });
    }

    if (!userId) return res.status(400).json({ success: false, message: 'userId is required when audience is not all' });

    const user = await User.findById(userId).select('email');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.email) return res.status(400).json({ success: false, message: 'This user has no email address on record' });

    await sendEmail({ to: user.email, subject, text: message });
    return res.json({ success: true, message: `Email sent to ${user.email}` });
  } catch (err) {
    console.error('sendEmailToUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error sending email' });
  }
};

exports.getMonthlyReportSettings = async (req, res) => {
  try {
    const settings = await getOrCreateAdminSettings();
    return res.json({ success: true, data: { monthlyReport: settings.monthlyReport } });
  } catch (err) {
    console.error('getMonthlyReportSettings error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateMonthlyReportSettings = async (req, res) => {
  try {
    const settings = await getOrCreateAdminSettings();
    const { autoSendEnabled, title, bodyTemplate, sendPush, sendEmail } = req.body;

    if (autoSendEnabled !== undefined) settings.monthlyReport.autoSendEnabled = !!autoSendEnabled;
    if (title !== undefined) settings.monthlyReport.title = String(title || '').trim() || DEFAULT_MONTHLY_REPORT_TITLE;
    if (bodyTemplate !== undefined) settings.monthlyReport.bodyTemplate = String(bodyTemplate || '');
    if (sendPush !== undefined) settings.monthlyReport.sendPush = !!sendPush;
    if (sendEmail !== undefined) settings.monthlyReport.sendEmail = !!sendEmail;

    await settings.save();

    return res.json({ success: true, message: 'Monthly report settings updated', data: { monthlyReport: settings.monthlyReport } });
  } catch (err) {
    console.error('updateMonthlyReportSettings error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
