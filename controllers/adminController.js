const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
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

function buildSelectedSessionsPdfBuffer({ userId, totalCount, liveCount, postCount, sessions }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('ConNavi Selected Session Report', { underline: true });
    doc.moveDown(0.6);
    doc.fontSize(11).text(`Generated At (UTC): ${new Date().toISOString()}`);
    doc.text(`User ID: ${String(userId)}`);
    doc.text(`Total Selected Sessions: ${totalCount}`);
    doc.text(`Live Sessions: ${liveCount}`);
    doc.text(`Post Sessions: ${postCount}`);
    doc.moveDown(1);

    doc.fontSize(12).text('Session Details');
    doc.moveDown(0.4);

    if (!sessions.length) {
      doc.fontSize(10).text('No selected sessions found.');
    } else {
      const pageBottom = 760;
      const renderLine = (label, value) => {
        if (doc.y > pageBottom) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(9).text(`${label}: `, { continued: true });
        doc.font('Helvetica').text(String(value ?? 'N/A'));
      };

      sessions.forEach((session, index) => {
        if (doc.y > pageBottom) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(10).text(`Session ${index + 1}`);
        renderLine('Session ID', session.sessionId);
        renderLine('Type', String(session.type || '').toUpperCase());
        renderLine('Status', session.status || 'unknown');
        renderLine('Created At (UTC)', session.createdAt || 'N/A');
        renderLine('Updated At (UTC)', session.updatedAt || 'N/A');
        renderLine('Started At (UTC)', session.startedAt || 'N/A');
        renderLine('Paused At (UTC)', session.pausedAt || 'N/A');
        renderLine('Resumed At (UTC)', session.resumedAt || 'N/A');
        renderLine('Completed At (UTC)', session.completedAt || 'N/A');
        renderLine('Total Duration (Minutes)', session.totalDurationMinutes ?? 'N/A');
        renderLine('Full Session Data (JSON)', JSON.stringify(session.fullData || {}, null, 2));
        doc.moveDown(0.6);
        doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#CCCCCC').stroke();
        doc.moveDown(0.6);
      });
    }

    doc.end();
  });
}

function buildMonthlySessionsPdfBuffer({ userId, userName, rangeStart, rangeEnd, summary, sessions }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const lineGap = 2;
    const pageBottom = 760;
    const renderLine = (label, value) => {
      if (doc.y > pageBottom) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(9).text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(String(value ?? 'N/A'), { lineGap });
    };

    doc.fontSize(16).font('Helvetica-Bold').text('I Feel Heard Monthly Session Report', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10).font('Helvetica').text(`Generated At (UTC): ${new Date().toISOString()}`);
    doc.text(`User ID: ${String(userId)}`);
    doc.text(`User Name: ${String(userName || 'User')}`);
    doc.text(`Report Window (UTC): ${rangeStart.toISOString()} to ${rangeEnd.toISOString()}`);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Summary');
    doc.font('Helvetica');
    doc.text(`Total Sessions: ${summary.total}`);
    doc.text(`Completed: ${summary.completed}`);
    doc.text(`Paused: ${summary.paused}`);
    doc.text(`Unresolved: ${summary.unresolved}`);
    doc.text(`Live Sessions: ${summary.live}`);
    doc.text(`Post Sessions: ${summary.post}`);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('All Session Details (Last 30 Days)');
    doc.moveDown(0.3);

    if (!sessions.length) {
      doc.font('Helvetica').fontSize(10).text('No sessions found in the last 30 days.');
      doc.end();
      return;
    }

    const toIsoOrNA = value => (value ? new Date(value).toISOString() : 'N/A');
    const renderStepSection = (title, entries) => {
      doc.font('Helvetica-Bold').fontSize(9).text(title);
      entries.forEach(([label, value]) => {
        renderLine(label, value);
      });
      doc.moveDown(0.2);
    };

    sessions.forEach((session, index) => {
      if (doc.y > pageBottom) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(10).text(`Session ${index + 1}`);
      renderLine('Session ID', session._id);
      renderLine('Type', String(session._sessionType || '').toUpperCase());
      renderLine('Status', session.status || 'unknown');
      renderLine('Created At (UTC)', toIsoOrNA(session.createdAt));
      renderLine('Updated At (UTC)', toIsoOrNA(session.updatedAt));
      renderLine('Started At (UTC)', toIsoOrNA(session.startedAt));
      renderLine('Paused At (UTC)', toIsoOrNA(session.pausedAt));
      renderLine('Resumed At (UTC)', toIsoOrNA(session.resumedAt));
      renderLine('Completed At (UTC)', toIsoOrNA(session.completedAt));
      renderLine('Total Duration (Minutes)', session.totalDurationMinutes ?? 'N/A');

      if (session._sessionType === 'post') {
        renderStepSection('Step 1 - Initial Distress', [
          ['Rating', session.step1?.rating ?? 'N/A'],
          ['Category', session.step1?.category ?? 'N/A'],
        ]);
        renderStepSection('Step 2 - Feelings', [
          ['Present Feelings', (session.step2?.presentFeelings || []).join(', ') || 'N/A'],
          ['Desired Feelings', (session.step2?.desiredFeelings || []).join(', ') || 'N/A'],
        ]);
        renderStepSection('Step 3 - Reflection', [
          ['Experience', session.step3?.experience ?? 'N/A'],
          ['React', session.step3?.react ?? 'N/A'],
          ['Assumption', session.step3?.assumption ?? 'N/A'],
          ['Thoughts', session.step3?.thoughts ?? 'N/A'],
          ['Understanding', session.step3?.understanding ?? 'N/A'],
          ['Terms', (session.step3?.terms || []).map(t => `${t.option}: ${t.description}`).join(' | ') || 'N/A'],
        ]);
        renderStepSection('Step 4 - Final Rating', [
          ['Rating', session.step4?.rating ?? 'N/A'],
          ['Category', session.step4?.category ?? 'N/A'],
          ['Feedback', session.step4?.feedbackMessage ?? 'N/A'],
        ]);
        renderStepSection('Step 5 - Completion', [
          ['Status', session.step5?.status ?? 'N/A'],
          ['Conflict Time (Minutes)', session.conflictTime ?? 'N/A'],
        ]);
      } else {
        renderStepSection('Step 1 - Initial Distress', [
          ['Rating', session.initialDistress?.rating ?? 'N/A'],
          ['Category', session.initialDistress?.category ?? 'N/A'],
        ]);
        renderStepSection('Step 2 - Breathing Exercise', [
          ['Used Breathing Exercise', session.isBreathingExercise === true ? 'Yes' : 'No'],
        ]);
        renderStepSection('Step 3 - Feelings', [
          ['Present Feelings', (session.presentFeelings || []).join(', ') || 'N/A'],
          ['Desired Feelings', (session.desiredFeelings || []).join(', ') || 'N/A'],
        ]);
        renderStepSection('Step 4 - Break', [
          ['Chose To Break', session.choseToBreak === true ? 'Yes' : 'No'],
          ['Break Reason', session.breakReason || 'N/A'],
          ['Resume At (UTC)', toIsoOrNA(session.resumeAt)],
        ]);
        renderStepSection('Step 5 - Non-negotiables', [
          ['Non-negotiables Agreed', session.nonNegotiablesAgreed === true ? 'Yes' : 'No'],
        ]);
        renderStepSection('Steps 6-10 - Conversation Cycles', [
          ['Cycle Count', Array.isArray(session.conversationCycles) ? session.conversationCycles.length : 0],
          ['Completed Cycles', (session.conversationCycles || []).filter(c => c.completed).length],
        ]);
        renderStepSection('Step 11 - Final Distress', [
          ['Rating', session.finalDistress?.rating ?? 'N/A'],
          ['Category', session.finalDistress?.category ?? 'N/A'],
        ]);
        renderStepSection('Step 12 - Completion', [
          ['Is Completed', session.isCompleted === true ? 'Yes' : 'No'],
        ]);
      }

      doc.moveDown(0.6);
      doc.moveTo(36, doc.y).lineTo(559, doc.y).strokeColor('#CCCCCC').stroke();
      doc.moveDown(0.6);
    });

    doc.end();
  });
}

async function buildDetailedSessionNotificationData(userId, sessionSelection = {}) {
  const { sessionIds = [], includeAllSessions = false } = sessionSelection;
  const normalizedIds = Array.isArray(sessionIds)
    ? sessionIds.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id))
    : [];

  const liveQuery = { userId };
  const postQuery = { userId };

  if (!includeAllSessions && normalizedIds.length) {
    liveQuery._id = { $in: normalizedIds };
    postQuery._id = { $in: normalizedIds };
  }

  const [liveSessions, postSessions] = await Promise.all([
    LiveConflictSession.find(liveQuery).sort({ createdAt: -1 }).lean(),
    PostConflictSession.find(postQuery).sort({ createdAt: -1 }).lean(),
  ]);

  return {
    type: 'admin_report_detailed',
    selected_session_ids_count: String(normalizedIds.length),
    live_session_count: String(liveSessions.length),
    post_session_count: String(postSessions.length),
    live_sessions: JSON.stringify(liveSessions),
    post_sessions: JSON.stringify(postSessions),
    _selectedLiveSessions: liveSessions,
    _selectedPostSessions: postSessions,
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

async function dispatchMonthlyReports({
  title,
  bodyTemplate,
  sendPush = true,
  sendEmail = true,
}) {
  const finalTitle = title || DEFAULT_MONTHLY_REPORT_TITLE;
  const now = new Date();
  const rangeEnd = now;
  const rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const users = await User.find({ role: 'user' }).select('_id name email fcmTokens');

  let pushSuccessCount = 0;
  let pushFailureCount = 0;
  let emailSuccessCount = 0;
  let emailFailureCount = 0;

  for (const user of users) {
    const [liveTotal, postTotal, liveCompleted, postCompleted, livePaused, postPaused, liveAbandoned, postAbandoned] =
      await Promise.all([
        LiveConflictSession.countDocuments({ userId: user._id, createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
        PostConflictSession.countDocuments({ userId: user._id, createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
        LiveConflictSession.countDocuments({ userId: user._id, status: 'completed', createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
        PostConflictSession.countDocuments({ userId: user._id, status: 'completed', createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
        LiveConflictSession.countDocuments({ userId: user._id, status: 'paused', createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
        PostConflictSession.countDocuments({ userId: user._id, status: 'paused', createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
        LiveConflictSession.countDocuments({ userId: user._id, status: 'abandoned', createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
        PostConflictSession.countDocuments({ userId: user._id, status: 'abandoned', createdAt: { $gte: rangeStart, $lte: rangeEnd } }),
      ]);

    const totalSessions = liveTotal + postTotal;
    const totalCompleted = liveCompleted + postCompleted;
    const totalPaused = livePaused + postPaused;
    const totalUnresolved = liveAbandoned + postAbandoned;
    const userName = user.name || 'there';

    const reportBody = totalSessions === 0
      ? `Hi ${userName}, you do not have any sessions in the last 30 days.`
      : (bodyTemplate
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
        : `Hi ${userName}! Your last 30 days summary: ${totalSessions} session(s) started, ${totalCompleted} completed, ${totalPaused} paused, ${totalUnresolved} unresolved.`);

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
        const [liveSessions, postSessions] = await Promise.all([
          LiveConflictSession.find({ userId: user._id, createdAt: { $gte: rangeStart, $lte: rangeEnd } }).sort({ createdAt: -1 }).lean(),
          PostConflictSession.find({ userId: user._id, createdAt: { $gte: rangeStart, $lte: rangeEnd } }).sort({ createdAt: -1 }).lean(),
        ]);
        const detailedSessions = [
          ...liveSessions.map(s => ({ ...s, _sessionType: 'live' })),
          ...postSessions.map(s => ({ ...s, _sessionType: 'post' })),
        ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        const pdfBuffer = await buildMonthlySessionsPdfBuffer({
          userId: user._id,
          userName,
          rangeStart,
          rangeEnd,
          summary: {
            total: totalSessions,
            completed: totalCompleted,
            paused: totalPaused,
            unresolved: totalUnresolved,
            live: liveTotal,
            post: postTotal,
          },
          sessions: detailedSessions,
        });

        const professionalText = [
          `Dear ${userName},`,
          '',
          'Please find your monthly session report for the last 30 days.',
          '',
          `Total sessions: ${totalSessions}`,
          `Completed: ${totalCompleted}`,
          `Paused: ${totalPaused}`,
          `Unresolved: ${totalUnresolved}`,
          `Live sessions: ${liveTotal}`,
          `Post sessions: ${postTotal}`,
          '',
          'A detailed PDF report is attached with complete session information for each session in this period.',
          '',
          'Regards,',
          'I Feel Heard Team',
        ].join('\n');

        const professionalHtml = `
          <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
            <p>Dear ${userName.replace(/</g, '&lt;').replace(/>/g, '&gt;')},</p>
            <p>Please find your monthly session report for the last 30 days.</p>
            <table style="border-collapse:collapse;">
              <tr><td style="padding:4px 10px 4px 0;"><strong>Total sessions</strong></td><td>${totalSessions}</td></tr>
              <tr><td style="padding:4px 10px 4px 0;"><strong>Completed</strong></td><td>${totalCompleted}</td></tr>
              <tr><td style="padding:4px 10px 4px 0;"><strong>Paused</strong></td><td>${totalPaused}</td></tr>
              <tr><td style="padding:4px 10px 4px 0;"><strong>Unresolved</strong></td><td>${totalUnresolved}</td></tr>
              <tr><td style="padding:4px 10px 4px 0;"><strong>Live sessions</strong></td><td>${liveTotal}</td></tr>
              <tr><td style="padding:4px 10px 4px 0;"><strong>Post sessions</strong></td><td>${postTotal}</td></tr>
            </table>
            <p>A detailed PDF report is attached with complete session information for each session in this period.</p>
            <p>Regards,<br/>I Feel Heard Team</p>
          </div>
        `;

        await sendEmail({
          to: user.email,
          subject: finalTitle,
          text: professionalText,
          html: professionalHtml,
          attachments: [{
            filename: `monthly-session-report-${String(user._id)}-${Date.now()}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          }],
        });
        emailSuccessCount += 1;
      } catch (err) {
        console.error(`monthly email failed for user ${user._id}:`, err?.message || err);
        emailFailureCount += 1;
      }
    }
  }

  return {
    title: finalTitle,
      period: {
      startDate: rangeStart,
      endDate: rangeEnd,
      monthKey: formatMonthKey(rangeStart),
    },
    summary: {
      totalUsers: users.length,
      push: { enabled: !!sendPush, successCount: pushSuccessCount, failureCount: pushFailureCount },
      email: {
        enabled: !!sendEmail,
        sentMail: !!sendEmail && emailSuccessCount > 0,
        successCount: emailSuccessCount,
        failureCount: emailFailureCount,
      },
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
    const {
      userId,
      audience,
      title,
      body,
      includeReport = false,
      sessionIds = [],
      includeAllSessions = false,
    } = req.body;
    if (!title || !body) return res.status(400).json({ success: false, message: 'title and body are required' });

    const isBroadcast = audience === 'all' || userId === 'all';

    if (isBroadcast) {
      const users = await User.find({ role: 'user' }).select('_id');
      let successCount = 0;
      let failureCount = 0;

      for (const user of users) {
        const notificationData = includeReport
          ? await buildDetailedSessionNotificationData(user._id, { sessionIds, includeAllSessions })
          : { type: 'admin_notification' };
        if (notificationData._selectedLiveSessions) delete notificationData._selectedLiveSessions;
        if (notificationData._selectedPostSessions) delete notificationData._selectedPostSessions;
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
      ? await buildDetailedSessionNotificationData(userId, { sessionIds, includeAllSessions })
      : { type: 'admin_notification' };

    const result = await sendPushToUser(userId, title, body, notificationData);
    const responseData = includeReport
      ? {
          selectedSessions: {
            live: notificationData._selectedLiveSessions || [],
            post: notificationData._selectedPostSessions || [],
          },
        }
      : undefined;

    if (notificationData._selectedLiveSessions) delete notificationData._selectedLiveSessions;
    if (notificationData._selectedPostSessions) delete notificationData._selectedPostSessions;

    return res.json({ success: true, message: 'Notification sent', result, data: responseData });
  } catch (err) {
    console.error('sendNotificationToUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.sendMonthlyNotificationsToAll = async (req, res) => {
  try {
    const {
      title = DEFAULT_MONTHLY_REPORT_TITLE,
      bodyTemplate = '',
      sendPush = true,
      sendEmail = true,
    } = req.body;
    const result = await dispatchMonthlyReports({
      title,
      bodyTemplate,
      sendPush,
      sendEmail,
    });
    return res.json({ success: true, message: `Monthly reports dispatched to ${result.summary.totalUsers} users`, ...result });
  } catch (err) {
    console.error('sendMonthlyNotificationsToAll error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.sendEmailToUser = async (req, res) => {
  try {
    const {
      userId,
      audience,
      subject,
      message,
      includeReport = false,
      sessionIds = [],
      includeAllSessions = false,
    } = req.body;
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

    const user = await User.findById(userId).select('email name');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.email) return res.status(400).json({ success: false, message: 'This user has no email address on record' });

    let emailBody = message;
    let emailHtml = null;
    let emailAttachments = [];
    let selectedSessions = { live: [], post: [] };

    if (includeReport) {
      const sessionData = await buildDetailedSessionNotificationData(userId, { sessionIds, includeAllSessions });
      selectedSessions = {
        live: sessionData._selectedLiveSessions || [],
        post: sessionData._selectedPostSessions || [],
      };

      const userName = user.name || 'User';
      const liveCount = selectedSessions.live.length;
      const postCount = selectedSessions.post.length;
      const totalCount = liveCount + postCount;

      const toSessionSummary = (session, type) => ({
        sessionId: String(session._id),
        type,
        status: session.status || 'unknown',
        createdAt: session.createdAt ? new Date(session.createdAt).toISOString() : null,
        updatedAt: session.updatedAt ? new Date(session.updatedAt).toISOString() : null,
        startedAt: session.startedAt ? new Date(session.startedAt).toISOString() : null,
        pausedAt: session.pausedAt ? new Date(session.pausedAt).toISOString() : null,
        resumedAt: session.resumedAt ? new Date(session.resumedAt).toISOString() : null,
        completedAt: session.completedAt ? new Date(session.completedAt).toISOString() : null,
        totalDurationMinutes: session.totalDurationMinutes ?? null,
        fullData: session,
      });

      const summarizedLive = selectedSessions.live.map(s => toSessionSummary(s, 'live'));
      const summarizedPost = selectedSessions.post.map(s => toSessionSummary(s, 'post'));

      const formatSessionLine = session => {
        const created = session.createdAt ? new Date(session.createdAt).toISOString() : 'N/A';
        return `- ${session.type.toUpperCase()} | id: ${session.sessionId} | status: ${session.status} | createdAt: ${created}`;
      };

      const liveLines = summarizedLive.map(formatSessionLine).join('\n');
      const postLines = summarizedPost.map(formatSessionLine).join('\n');

      emailBody = [
        `Hi ${userName},`,
        '',
        'Admin Message:',
        message,
        '',
        'Your Session Report:',
        `- Total Selected Sessions: ${totalCount}`,
        `- Live Sessions: ${liveCount}`,
        `- Post Sessions: ${postCount}`,
        '',
        liveCount ? 'Live Session Details:\n' + liveLines : 'Live Session Details:\n- None',
        '',
        postCount ? 'Post Session Details:\n' + postLines : 'Post Session Details:\n- None',
        '',
        'Regards,',
        'ConNavi Admin Team',
      ].join('\n');

      const allSessions = [...summarizedLive, ...summarizedPost];
      const escapeHtml = str =>
        String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

      const tableRows = allSessions.length
        ? allSessions
            .map(
              s => `
                <tr>
                  <td>${escapeHtml(s.sessionId)}</td>
                  <td>${escapeHtml((s.type || '').toUpperCase())}</td>
                  <td>${escapeHtml(s.status || 'unknown')}</td>
                  <td>${escapeHtml(s.createdAt || 'N/A')}</td>
                </tr>`
            )
            .join('')
        : `<tr><td colspan="4">No selected sessions found.</td></tr>`;

      const pdfBuffer = await buildSelectedSessionsPdfBuffer({
        userId,
        totalCount,
        liveCount,
        postCount,
        sessions: allSessions,
      });

      const reportFileName = `selected-sessions-${String(userId)}-${Date.now()}.pdf`;
      emailAttachments = [
        {
          filename: reportFileName,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ];

      emailBody = [
        message,
        '',
        'Please refer to the attached document for the related selected session details.',
      ].join('\n');

      emailHtml = `<p style="white-space:pre-wrap;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p><p>Please refer to the attached document for the related selected session details.</p>`;
    }

    await sendEmail({
      to: user.email,
      subject,
      text: emailBody,
      html: emailHtml || undefined,
      attachments: emailAttachments,
    });
    return res.json({
      success: true,
      message: `Email sent to ${user.email}`,
      data: includeReport
        ? {
            selectedSessions: {
              live: selectedSessions.live,
              post: selectedSessions.post,
            },
          }
        : undefined,
    });
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
