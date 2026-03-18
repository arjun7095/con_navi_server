const User = require('../models/User');
const PostConflictSession = require('../models/PostConflictSession');
const LiveConflictSession = require('../models/LiveConflictSession');
const mongoose = require('mongoose');
// ──────────────────────────────────────────────────────────────
// GET /api/profile/:userId
// ──────────────────────────────────────────────────────────────
exports.getProfileById = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      '-refreshToken -__v -otp -otpExpires'
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      profile: {
        userId: user._id.toString(),
        countryCode: user.countryCode,
        mobile: user.mobile,
        role: user.role,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        profileImageUrl: user.profileImageUrl,
        notificationPreference: user.notificationPreference,
        dataAnalyticsEnabled: user.dataAnalyticsEnabled,
        isProfileComplete: user.isProfileComplete,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ──────────────────────────────────────────────────────────────
// PUT /api/profile/:userId
// ──────────────────────────────────────────────────────────────
// src/controllers/userController.js (or wherever your profile update lives)

exports.updateProfileById = async (req, res) => {
  try {
    const requestedUserId = req.params.userId;
    const currentUserId = req.user.userId;
    const isAdmin = req.user.role === 'admin';

    // Security: only allow own profile update (admins can update any)
    if (requestedUserId !== currentUserId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own profile',
      });
    }

    // Allowed fields – add more as needed
    const allowedFields = [
      'name',
      'email',
      'avatar',                // base64 image string
      'profileImageUrl',       // base64 or external URL
      'notificationPreference',
      'dataAnalyticsEnabled',
      // 'ageGroup', 'gender', etc. – add if you have them
    ];

    const updates = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Validate enum fields
    if (
      updates.notificationPreference &&
      !['all', 'important', 'none'].includes(updates.notificationPreference)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notificationPreference value',
      });
    }

    // Basic base64 validation for images (prevent invalid data)
    const isValidBase64 = (str) => {
      if (typeof str !== 'string') return false;
      // Strip optional data URI prefix
      const base64 = str.replace(/^data:image\/[a-z]+;base64,/, '');
      // Check valid base64 chars and reasonable length
      return /^[A-Za-z0-9+/=]+$/.test(base64) && base64.length >= 20;
    };

    if (updates.avatar && !isValidBase64(updates.avatar)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid base64 string for avatar',
      });
    }

    if (updates.profileImageUrl && !isValidBase64(updates.profileImageUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid base64 string for profileImageUrl',
      });
    }

    // Perform the update
    const updatedUser = await User.findByIdAndUpdate(
      requestedUserId,
      { $set: updates },
      {
        returnDocument: 'after',   // modern replacement for { new: true }
        runValidators: true,
      }
    ).select('-refreshToken -__v -otp -otpExpires -password'); // exclude sensitive fields

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Optional: Re-check profile completeness (if your logic needs it)
    if (!updatedUser.isProfileComplete) {
      updatedUser.isProfileComplete = !!(
        updatedUser.name &&
        updatedUser.email &&
        (updatedUser.avatar || updatedUser.profileImageUrl) &&
        updatedUser.notificationPreference
      );
      await updatedUser.save({ validateBeforeSave: false }); // skip validators if needed
    }

    // Clean response – only safe fields
    return res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        userId: updatedUser._id.toString(),
        countryCode: updatedUser.countryCode,
        mobile: updatedUser.mobile,
        role: updatedUser.role,
        name: updatedUser.name,
        email: updatedUser.email,
        avatar: updatedUser.avatar,
        profileImageUrl: updatedUser.profileImageUrl,
        notificationPreference: updatedUser.notificationPreference,
        dataAnalyticsEnabled: updatedUser.dataAnalyticsEnabled,
        isProfileComplete: updatedUser.isProfileComplete,
      },
    });
  } catch (err) {
    console.error('updateProfileById error:', err);

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate value (e.g. email already exists)',
      });
    }

    if (err.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Server error while updating profile',
    });
  }
};

// ──────────────────────────────────────────────────────────────
// DELETE /api/profile/:userId  (self-delete)
// ──────────────────────────────────────────────────────────────
exports.deleteProfileById = async (req, res) => {
  try {
    const requestedUserId = req.params.userId;
    const currentUserId = req.user.userId;

    if (requestedUserId !== currentUserId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own account'
      });
    }

    const user = await User.findById(requestedUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Optional: soft delete instead of hard remove
    // user.isDeleted = true;
    // user.deletedAt = new Date();
    // await user.save();

    // Hard delete (be careful!)
    await User.deleteOne({ _id: requestedUserId });

    // Optional: revoke Firebase token / sign out user sessions
    // await admin.auth().revokeRefreshTokens(user.firebaseUid);

    return res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};


exports.getConflictStats = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);

    // ── 1. TOTAL CONFLICT COUNTS ─────────────────────────
    const totalPost = await PostConflictSession.countDocuments({ userId });
    const totalLive = await LiveConflictSession.countDocuments({ userId });

    const totalConflicts = totalPost + totalLive;

    // ── 2. AVERAGE POST CONFLICT TIME ────────────────────
    const postCompletedAvg = await PostConflictSession.aggregate([
      {
        $match: {
          userId,
          status: "completed",
          conflictTime: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: null,
          average: { $avg: "$conflictTime" }
        }
      }
    ]);

    const avgPostTime =
      postCompletedAvg.length > 0
        ? Math.round(postCompletedAvg[0].average)
        : 0;

    // ── 3. AVERAGE LIVE CONFLICT TIME ────────────────────
    const liveCompletedAvg = await LiveConflictSession.aggregate([
      {
        $match: {
          userId,
          status: "completed",
          totalDurationMinutes: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: null,
          average: { $avg: "$totalDurationMinutes" }
        }
      }
    ]);

    const avgLiveTime =
      liveCompletedAvg.length > 0
        ? Math.round(liveCompletedAvg[0].average)
        : 0;

    // ── 4. COMBINED AVERAGE TIME ─────────────────────────
    const times = [avgPostTime, avgLiveTime].filter(v => v > 0);

    const combinedAvgTime =
      times.length > 0
        ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
        : 0;

    // ── 5. COMMON PATTERNS ACROSS SESSIONS ───────────────
    const postPatterns = await PostConflictSession.aggregate([
      {
        $match: {
          userId,
          status: "completed",
          commonPatterns: { $exists: true, $ne: [] }
        }
      },
      { $unwind: "$commonPatterns" },
      {
        $group: {
          _id: "$commonPatterns",
          count: { $sum: 1 }
        }
      }
    ]);

    const livePatterns = await LiveConflictSession.aggregate([
      {
        $match: {
          userId,
          status: "completed",
          commonPatterns: { $exists: true, $ne: [] }
        }
      },
      { $unwind: "$commonPatterns" },
      {
        $group: {
          _id: "$commonPatterns",
          count: { $sum: 1 }
        }
      }
    ]);

    // Merge pattern counts
    const patternMap = new Map();

    [...postPatterns, ...livePatterns].forEach(p => {
      const key = p._id;
      patternMap.set(key, (patternMap.get(key) || 0) + p.count);
    });

    const commonPatterns = Array.from(patternMap.entries()).filter(
      ([pattern, count]) => count > 1
    );

    const uniqueCommonPatternsCount = commonPatterns.length;

    // ── RESPONSE ─────────────────────────────────────────
    res.json({
      success: true,
      stats: {
        totalConflicts,
        totalPostConflicts: totalPost,
        totalLiveConflicts: totalLive,
        averageTimeMinutes: combinedAvgTime,
        averagePostTimeMinutes: avgPostTime,
        averageLiveTimeMinutes: avgLiveTime,
        uniqueCommonPatternsCount
      }
    });
  } catch (error) {
    console.error("getConflictStats error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching stats"
    });
  }
};


exports.getTrendsAnalytics = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.userId);

    const { startDate, endDate } = req.body || {};

    let startUTC;
    let endUTC;

    if (startDate && endDate) {
      startUTC = new Date(startDate);
      endUTC = new Date(endDate);
      endUTC.setHours(23, 59, 59, 999);
    } else {
      endUTC = new Date();
      startUTC = new Date();
      startUTC.setDate(startUTC.getDate() - 7);
    }

    const baseFilter = {
      userId,
      status: "completed",
      createdAt: {
        $gte: startUTC,
        $lte: endUTC
      }
    };

    // ── MOST COMMON FEELINGS ─────────────────────────────
    const postFeelings = await PostConflictSession.aggregate([
      { $match: baseFilter },
      { $unwind: "$presentFeelings" },
      { $group: { _id: "$presentFeelings", count: { $sum: 1 } } }
    ]);

    const liveFeelings = await LiveConflictSession.aggregate([
      { $match: baseFilter },
      { $unwind: "$presentFeelings" },
      { $group: { _id: "$presentFeelings", count: { $sum: 1 } } }
    ]);

    const feelingMap = new Map();

    [...postFeelings, ...liveFeelings].forEach(f => {
      const key = f._id;
      feelingMap.set(key, (feelingMap.get(key) || 0) + f.count);
    });

    const mostCommonFeelings = Array.from(feelingMap.entries())
      .map(([feeling, count]) => ({
        feeling,
        times: count
      }))
      .sort((a, b) => b.times - a.times)
      .slice(0, 10);

    // ── MOST COMMON NEEDS ─────────────────────────────
    const postNeeds = await PostConflictSession.aggregate([
      { $match: baseFilter },
      { $unwind: "$desiredFeelings" },
      { $group: { _id: "$desiredFeelings", count: { $sum: 1 } } }
    ]);

    const liveNeeds = await LiveConflictSession.aggregate([
      { $match: baseFilter },
      { $unwind: "$desiredFeelings" },
      { $group: { _id: "$desiredFeelings", count: { $sum: 1 } } }
    ]);

    const needsMap = new Map();

    [...postNeeds, ...liveNeeds].forEach(n => {
      const key = n._id;
      needsMap.set(key, (needsMap.get(key) || 0) + n.count);
    });

    const mostCommonNeeds = Array.from(needsMap.entries())
      .map(([need, count]) => ({
        need,
        times: count
      }))
      .sort((a, b) => b.times - a.times)
      .slice(0, 10);

    // ── CONFLICT COUNTS ─────────────────────────────
    const postConflictCount = await PostConflictSession.countDocuments(baseFilter);
    const liveConflictCount = await LiveConflictSession.countDocuments(baseFilter);

    // ── RESPONSE ─────────────────────────────────────
    res.json({
      success: true,
      data: {
        mostCommonFeelings,
        mostCommonNeeds,
        postConflictCount,
        liveConflictCount
      }
    });

  } catch (error) {
    console.error("getTrendsAnalytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch conflict trends",
      error: error.message
    });
  }
};

exports.deleteConflict = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { type, sessionId } = req.body;

    if (!type || !sessionId) {
      return res.status(400).json({
        success: false,
        message: "type and sessionId are required"
      });
    }

    let deletedSession;

    if (type === "live") {
      deletedSession = await LiveConflictSession.findOneAndDelete({
        _id: sessionId,
        userId
      });
    } else if (type === "post") {
      deletedSession = await PostConflictSession.findOneAndDelete({
        _id: sessionId,
        userId
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid conflict type"
      });
    }

    if (!deletedSession) {
      return res.status(404).json({
        success: false,
        message: "Conflict session not found or not authorized"
      });
    }

    res.json({
      success: true,
      message: "Conflict session deleted successfully"
    });

  } catch (error) {
    console.error("deleteConflict error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};
