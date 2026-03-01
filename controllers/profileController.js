const User = require('../models/User');

// ──────────────────────────────────────────────────────────────
// GET /api/profile/:userId
// ──────────────────────────────────────────────────────────────
exports.getProfileById = async (req, res) => {
  try {
    const requestedUserId = req.params.userId;
    const currentUserId = req.user.userId; // from protect middleware

    // Optional: only allow fetching own profile (or admin)
    // if (requestedUserId !== currentUserId && req.user.role !== 'admin') {
    //   return res.status(403).json({ success: false, message: "Not authorized to view this profile" });
    // }

    const user = await User.findById(requestedUserId).select(
      '-refreshToken -otp -otpExpires -__v' // exclude sensitive fields
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.json({
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
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ──────────────────────────────────────────────────────────────
// PUT /api/profile/:userId
// ──────────────────────────────────────────────────────────────
exports.updateProfileById = async (req, res) => {
  try {
    const requestedUserId = req.params.userId;
    const currentUserId = req.user.userId;

    // Security: only allow updating own profile (or admin)
    if (requestedUserId !== currentUserId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own profile'
      });
    }

    const allowedFields = [
      'name', 'email', 'avatar', 'profileImageUrl',
      'notificationPreference', 'dataAnalyticsEnabled'
      // add more if needed: ageGroup, gender, etc.
    ];

    const updates = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Optional validation examples
    if (updates.notificationPreference &&
        !['all', 'important', 'none'].includes(updates.notificationPreference)) {
      return res.status(400).json({ success: false, message: 'Invalid notification preference' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      requestedUserId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-refreshToken -__v');

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Optional: re-evaluate profile completeness
    if (!updatedUser.isProfileComplete) {
      updatedUser.isProfileComplete = !!(
        updatedUser.name &&
        updatedUser.email &&
        updatedUser.profileImageUrl &&
        updatedUser.notificationPreference
      );
      await updatedUser.save();
    }

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
        isProfileComplete: updatedUser.isProfileComplete
      }
    });
  } catch (err) {
    console.error(err);
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Duplicate value (email?)' });
    }
    return res.status(500).json({ success: false, message: 'Server error' });
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