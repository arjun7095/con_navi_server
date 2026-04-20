const mongoose = require('mongoose');
const User = require('../models/User');
const LiveConflictSession = require('../models/LiveConflictSession');
const PostConflictSession = require('../models/PostConflictSession');
const { sendPushToUser } = require('./notificationController');
const { sendEmail } = require('../utils/emailService');
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE64_IMAGE_REGEX = /^[A-Za-z0-9+/=]+$/;
const IMAGE_DATA_URI_REGEX = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/;

// ─── Keyword Extraction ──────────────────────────────────────────────────────────

// Common English stop words to exclude from conflict keyword analysis
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us',
  'them', 'my', 'your', 'his', 'its', 'our', 'their', 'what', 'which', 'who',
  'when', 'where', 'why', 'how', 'not', 'no', 'so', 'if', 'as', 'up', 'out',
  'about', 'into', 'through', 'than', 'then', 'just', 'also', 'more', 'very',
  'some', 'all', 'any', 'each', 'few', 'both', 'most', 'other', 'such',
  'only', 'own', 'same', 'too', 'here', 'there', 'lot', 'lots', 'bit',
  'said', 'get', 'got', 'go', 'went', 'gone', 'come', 'came', 'take', 'took',
  'make', 'made', 'know', 'knew', 'think', 'thought', 'see', 'saw', 'want',
  'wanted', 'need', 'needed', 'feel', 'felt', 'like', 'liked', 'time', 'way',
  'day', 'year', 'work', 'used', 'use', 'one', 'two', 'three', 'four', 'five',
  'really', 'much', 'many', 'now', 'still', 'back', 'after', 'first',
  'well', 'even', 'because', 'before', 'between', 'again', 'while', 'new',
  'right', 'old', 'never', 'always', 'every', 'over', 'under', 'around',
  'another', 'something', 'nothing', 'everything', 'anything', 'someone',
  'everyone', 'anywhere', 'somehow', 'actually', 'already', 'although',
  'however', 'therefore', 'since', 'during', 'until', 'upon', 'against',
  'toward', 'along', 'following', 'across', 'behind', 'beyond', 'except',
  'itself', 'himself', 'herself', 'themselves', 'myself', 'yourself',
  'am', 'im', 'ive', 'id', 'ill', 'dont', 'doesnt', 'didnt', 'wont',
  'wouldnt', 'couldnt', 'shouldnt', 'cant', 'cannot', 'havent', 'hasnt',
  'hadnt', 'wasnt', 'werent', 'isnt', 'arent', 'quite', 'rather', 'pretty',
  'enough', 'thats', 'theres', 'its', 'youre', 'theyre', 'weve', 'theyd',
]);

/**
 * Extract top conflict-related keywords from an array of text strings.
 * Removes stop words and short words. Returns top N by frequency.
 */
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

/** Sort object entries by count descending, return top 20 */
function sortByCount(obj) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([value, count]) => ({ value, count }));
}

/** Build status breakdown from a sessions array */
function buildStatusStats(sessions) {
  return {
    total: sessions.length,
    completed: sessions.filter(s => s.status === 'completed').length,
    paused: sessions.filter(s => s.status === 'paused').length,
    abandoned: sessions.filter(s => s.status === 'abandoned').length,
    active: sessions.filter(s => s.status === 'active').length,
  };
}

/** Build a MongoDB date range filter object */
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
    user.name &&
    user.email &&
    (user.avatar || user.profileImageUrl) &&
    user.notificationPreference
  );
}

function isValidImageValue(value) {
  if (typeof value !== 'string') return false;

  const trimmedValue = value.trim();
  if (!trimmedValue) return false;

  try {
    const parsedUrl = new URL(trimmedValue);
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      return true;
    }
  } catch (_) {
    // Continue to base64 validation.
  }

  if (IMAGE_DATA_URI_REGEX.test(trimmedValue)) return true;

  return BASE64_IMAGE_REGEX.test(trimmedValue) && trimmedValue.length >= 20;
}

// GET /api/admin/me
exports.getAdminSelf = async (req, res) => {
  try {
    const admin = await User.findOne({
      _id: req.user.userId,
      role: 'admin',
    }).select('-refreshTokens -fcmTokens');

    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    return res.json({
      success: true,
      data: {
        admin: buildAdminProfile(admin),
      },
    });
  } catch (err) {
    console.error('getAdminSelf error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PUT /api/admin/me
exports.updateAdminSelf = async (req, res) => {
  try {
    const allowedFields = [
      'name',
      'email',
      'avatar',
      'profileImageUrl',
      'notificationPreference',
      'dataAnalyticsEnabled',
    ];

    const updates = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (!Object.keys(updates).length) {
      return res.status(400).json({
        success: false,
        message: 'Provide at least one valid field to update',
      });
    }

    if (updates.name !== undefined) {
      if (typeof updates.name !== 'string' || !updates.name.trim()) {
        return res.status(400).json({
          success: false,
          message: 'name must be a non-empty string',
        });
      }
      updates.name = updates.name.trim();
    }

    if (updates.email !== undefined) {
      if (typeof updates.email !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'email must be a string',
        });
      }

      updates.email = updates.email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(updates.email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email address',
        });
      }
    }

    if (
      updates.notificationPreference !== undefined &&
      !['all', 'important', 'none'].includes(updates.notificationPreference)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notificationPreference value',
      });
    }

    if (
      updates.dataAnalyticsEnabled !== undefined &&
      typeof updates.dataAnalyticsEnabled !== 'boolean'
    ) {
      return res.status(400).json({
        success: false,
        message: 'dataAnalyticsEnabled must be a boolean',
      });
    }

    if (updates.avatar !== undefined && !isValidImageValue(updates.avatar)) {
      return res.status(400).json({
        success: false,
        message: 'avatar must be a valid image URL or base64 string',
      });
    }

    if (
      updates.profileImageUrl !== undefined &&
      !isValidImageValue(updates.profileImageUrl)
    ) {
      return res.status(400).json({
        success: false,
        message: 'profileImageUrl must be a valid image URL or base64 string',
      });
    }

    const admin = await User.findOne({
      _id: req.user.userId,
      role: 'admin',
    });

    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    Object.assign(admin, updates);
    admin.isProfileComplete = calculateProfileCompleteness(admin);
    await admin.save();

    return res.json({
      success: true,
      message: 'Admin details updated successfully',
      data: {
        admin: buildAdminProfile(admin),
      },
    });
  } catch (err) {
    console.error('updateAdminSelf error:', err);

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate value (for example email already exists)',
      });
    }

    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// DELETE /api/admin/me
exports.deleteAdminSelf = async (req, res) => {
  try {
    const admin = await User.findOne({
      _id: req.user.userId,
      role: 'admin',
    }).select('_id');

    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    await Promise.all([
      User.deleteOne({ _id: admin._id }),
      LiveConflictSession.deleteMany({ userId: admin._id }),
      PostConflictSession.deleteMany({ userId: admin._id }),
    ]);

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    return res.json({
      success: true,
      message: 'Admin account deleted successfully',
    });
  } catch (err) {
    console.error('deleteAdminSelf error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ─── 1. Dashboard Overview ───────────────────────────────────────────────────────

exports.getOverview = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

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
      User.countDocuments({ role: 'user', lastLogin: { $gte: thirtyDaysAgo } }),
      LiveConflictSession.countDocuments(),
      PostConflictSession.countDocuments(),
      LiveConflictSession.countDocuments({ status: 'completed' }),
      PostConflictSession.countDocuments({ status: 'completed' }),
      LiveConflictSession.countDocuments({ status: 'paused' }),
      PostConflictSession.countDocuments({ status: 'paused' }),
      LiveConflictSession.countDocuments({ status: 'abandoned' }),
      PostConflictSession.countDocuments({ status: 'abandoned' }),
    ]);

    return res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          activeLast30Days: activeUsers,
          inactive: totalUsers - activeUsers,
        },
        sessions: {
          live: {
            total: totalLive,
            completed: completedLive,
            paused: pausedLive,
            abandoned: abandonedLive,
          },
          post: {
            total: totalPost,
            completed: completedPost,
            paused: pausedPost,
            abandoned: abandonedPost,
          },
          combined: {
            total: totalLive + totalPost,
            completed: completedLive + completedPost,
            paused: pausedLive + pausedPost,
            abandoned: abandonedLive + abandonedPost,
          },
        },
      },
    });
  } catch (err) {
    console.error('getOverview error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ─── 2. User List (with search & pagination) ─────────────────────────────────────

exports.getUserList = async (req, res) => {
  try {
    const {
      search = '',
      page = 1,
      limit = 20,
      profileComplete,
      sortBy = 'lastLogin',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = { role: { $ne: 'admin' } };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    if (profileComplete !== undefined) {
      filter.isProfileComplete = profileComplete === 'true';
    }

    const sortOptions = {};
    if (sortBy === 'createdAt') sortOptions.createdAt = -1;
    else sortOptions.lastLogin = -1;

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('name mobile email avatar role isProfileComplete lastLogin createdAt')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        users,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('getUserList error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ─── 3. User Detail ──────────────────────────────────────────────────────────────

exports.getUserDetail = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('-refreshTokens -fcmTokens');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const [liveSessions, postSessions] = await Promise.all([
      LiveConflictSession.find({ userId }).sort({ createdAt: -1 }),
      PostConflictSession.find({ userId }).sort({ createdAt: -1 }),
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
      },
    });
  } catch (err) {
    console.error('getUserDetail error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ─── 4. Time-Based Analytics ─────────────────────────────────────────────────────

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
          byDayOfWeek: [
            { $group: { _id: { $dayOfWeek: '$createdAt' }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          byHour: [
            { $group: { _id: { $hour: '$createdAt' }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          byMonth: [
            {
              $group: {
                _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                count: { $sum: 1 },
              },
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ];

    const formatResult = ([facet]) => ({
      busiestDays: (facet?.byDayOfWeek || []).map(d => ({
        day: DAY_NAMES[d._id - 1] || 'Unknown',
        count: d.count,
      })),
      busiestHours: (facet?.byHour || []).map(d => ({
        hour: d._id,
        label: `${String(d._id).padStart(2, '0')}:00`,
        count: d.count,
      })),
      monthlyTrend: (facet?.byMonth || []).map(d => ({
        year: d._id.year,
        month: d._id.month,
        count: d.count,
      })),
      total: facet?.total[0]?.count || 0,
    });

    const results = {};

    if (!sessionType || sessionType === 'live') {
      const raw = await LiveConflictSession.aggregate(pipeline);
      results.live = formatResult(raw);
    }

    if (!sessionType || sessionType === 'post') {
      const raw = await PostConflictSession.aggregate(pipeline);
      results.post = formatResult(raw);
    }

    return res.json({ success: true, data: results });
  } catch (err) {
    console.error('getTimeBasedAnalytics error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ─── 5. Session Analytics (feelings, keywords, completion counts) ─────────────────

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
      // Texts from conversation cycles – speaking (step 8/9 content) and listening
      const speakingTexts = [];
      const listeningTexts = [];

      for (const session of liveSessions) {
        (session.presentFeelings || []).forEach(f => {
          presentFeelings[f] = (presentFeelings[f] || 0) + 1;
        });
        (session.desiredFeelings || []).forEach(f => {
          desiredFeelings[f] = (desiredFeelings[f] || 0) + 1;
        });

        // Extract text from conversation cycles (steps 6–10 speaking/listening content)
        (session.conversationCycles || []).forEach(cycle => {
          const sp = cycle.speaking;
          if (sp) {
            speakingTexts.push(
              sp.experience,
              sp.assumptions,
              sp.when,
              sp.request,
              ...(sp.structuredStatements || []),
            );
          }
          if (cycle.listening) {
            listeningTexts.push(...(cycle.listening.communicated || []));
          }
        });
      }

      results.live = {
        statusBreakdown: buildStatusStats(liveSessions),
        feelings: {
          present: sortByCount(presentFeelings),
          desired: sortByCount(desiredFeelings),
        },
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
      const step3Texts = [];

      for (const session of postSessions) {
        (session.step2?.presentFeelings || []).forEach(f => {
          presentFeelings[f] = (presentFeelings[f] || 0) + 1;
        });
        (session.step2?.desiredFeelings || []).forEach(f => {
          desiredFeelings[f] = (desiredFeelings[f] || 0) + 1;
        });

        const s3 = session.step3;
        if (s3) {
          step3Texts.push(
            s3.experience,
            s3.react,
            s3.assumption,
            s3.thoughts,
            s3.understanding,
            ...(s3.terms || []).map(t => `${t.option} ${t.description}`),
          );
        }
      }

      results.post = {
        statusBreakdown: buildStatusStats(postSessions),
        feelings: {
          present: sortByCount(presentFeelings),
          desired: sortByCount(desiredFeelings),
        },
        keywords: extractKeywords(step3Texts.filter(Boolean)),
      };
    }

    return res.json({ success: true, data: results });
  } catch (err) {
    console.error('getSessionAnalytics error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ─── 6. Send On-Demand Notification to Specific User ─────────────────────────────

exports.sendNotificationToUser = async (req, res) => {
  try {
    const { userId, title, body, includeReport = false } = req.body;

    if (!userId || !title || !body) {
      return res.status(400).json({
        success: false,
        message: 'userId, title, and body are required',
      });
    }

    const user = await User.findById(userId).select('name email fcmTokens');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let notificationData = { type: 'admin_notification' };

    if (includeReport) {
      const [liveSessions, postSessions] = await Promise.all([
        LiveConflictSession.find({ userId }),
        PostConflictSession.find({ userId }),
      ]);

      const liveStats = buildStatusStats(liveSessions);
      const postStats = buildStatusStats(postSessions);

      notificationData = {
        type: 'admin_report',
        live_completed: String(liveStats.completed),
        live_paused: String(liveStats.paused),
        live_abandoned: String(liveStats.abandoned),
        post_completed: String(postStats.completed),
        post_paused: String(postStats.paused),
        post_abandoned: String(postStats.abandoned),
      };
    }

    const result = await sendPushToUser(userId, title, body, notificationData);

    return res.json({
      success: true,
      message: 'Notification sent',
      result,
    });
  } catch (err) {
    console.error('sendNotificationToUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ─── 7. Send Monthly Notifications to All Users ──────────────────────────────────

exports.sendMonthlyNotificationsToAll = async (req, res) => {
  try {
    const { title, bodyTemplate } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: 'title is required' });
    }

    const now = new Date();
    const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const users = await User.find({
      role: 'user',
      fcmTokens: { $exists: true, $ne: [] },
    }).select('_id name');

    let totalSuccess = 0;
    let totalFailure = 0;

    for (const user of users) {
      const [liveTotal, postTotal, liveCompleted, postCompleted, livePaused, postPaused] =
        await Promise.all([
          LiveConflictSession.countDocuments({
            userId: user._id,
            createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth },
          }),
          PostConflictSession.countDocuments({
            userId: user._id,
            createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth },
          }),
          LiveConflictSession.countDocuments({
            userId: user._id,
            status: 'completed',
            createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth },
          }),
          PostConflictSession.countDocuments({
            userId: user._id,
            status: 'completed',
            createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth },
          }),
          LiveConflictSession.countDocuments({
            userId: user._id,
            status: 'paused',
            createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth },
          }),
          PostConflictSession.countDocuments({
            userId: user._id,
            status: 'paused',
            createdAt: { $gte: firstOfPrevMonth, $lte: lastOfPrevMonth },
          }),
        ]);

      const totalSessions = liveTotal + postTotal;
      const totalCompleted = liveCompleted + postCompleted;
      const totalPaused = livePaused + postPaused;
      const userName = user.name || 'there';

      const notifBody = bodyTemplate
        ? bodyTemplate
            .replace('{name}', userName)
            .replace('{total}', totalSessions)
            .replace('{completed}', totalCompleted)
            .replace('{paused}', totalPaused)
            .replace('{liveSessions}', liveTotal)
            .replace('{postSessions}', postTotal)
            .replace('{liveCompleted}', liveCompleted)
            .replace('{postCompleted}', postCompleted)
        : `Hi ${userName}! Your monthly summary: ${totalSessions} session(s) started, ${totalCompleted} completed, ${totalPaused} paused. Keep up the great work!`;

      const data = {
        type: 'monthly_report',
        live_total: String(liveTotal),
        post_total: String(postTotal),
        live_completed: String(liveCompleted),
        post_completed: String(postCompleted),
        live_paused: String(livePaused),
        post_paused: String(postPaused),
      };

      const result = await sendPushToUser(user._id.toString(), title, notifBody, data);
      if (result.successCount > 0) totalSuccess++;
      else totalFailure++;
    }

    return res.json({
      success: true,
      message: `Monthly notifications dispatched to ${users.length} users`,
      summary: {
        totalUsers: users.length,
        successCount: totalSuccess,
        failureCount: totalFailure,
      },
    });
  } catch (err) {
    console.error('sendMonthlyNotificationsToAll error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ─── 8. Send Email to Specific User ──────────────────────────────────────────────

exports.sendEmailToUser = async (req, res) => {
  try {
    const { userId, subject, message } = req.body;

    if (!userId || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'userId, subject, and message are required',
      });
    }

    const user = await User.findById(userId).select('email name');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.email) {
      return res.status(400).json({
        success: false,
        message: 'This user has no email address on record',
      });
    }

    await sendEmail({ to: user.email, subject, text: message });

    return res.json({
      success: true,
      message: `Email sent to ${user.email}`,
    });
  } catch (err) {
    console.error('sendEmailToUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error sending email' });
  }
};
