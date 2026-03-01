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
    const isAdmin = req.user.role === 'admin';

    // Security: only allow updating own profile (or admin)
    if (requestedUserId !== currentUserId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own profile',
      });
    }

    const allowedFields = [
      'name',
      'email',
      'avatar',                // base64 image
      'profileImageUrl',       // base64 or URL
      'notificationPreference',
      'dataAnalyticsEnabled',
      // Add more fields if needed: ageGroup, gender, etc.
    ];

    const updates = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Validate allowed enum fields
    if (
      updates.notificationPreference &&
      !['all', 'important', 'none'].includes(updates.notificationPreference)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification preference value',
      });
    }

    // Optional: Basic base64 validation for images
    const validateBase64 = (base64String) => {
      if (typeof base64String !== 'string') return false;
      // Remove data:image/...;base64, prefix if present
      const cleanBase64 = base64String.replace(/^data:image\/[a-z]+;base64,/, '');
      // Check if it's valid base64 (simple regex + length)
      return /^[A-Za-z0-9+/=]+$/.test(cleanBase64) && cleanBase64.length > 20; // min length to avoid junk
    };

    if (updates.avatar && !validateBase64(updates.avatar)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid base64 format for avatar',
      });
    }

    if (updates.profileImageUrl && !validateBase64(updates.profileImageUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid base64 format for profileImageUrl',
      });
    }

    // Perform the update using modern MongoDB option
    const updatedUser = await User.findByIdAndUpdate(
      requestedUserId,
      { $set: updates },
      {
        returnDocument: 'after',     // ← modern replacement for { new: true }
        runValidators: true,
        new: false,                  // we use returnDocument instead
      }
    ).select('-refreshToken -__v -otp -otpExpires'); // exclude sensitive fields

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Optional: Re-evaluate profile completeness (if you still want it)
    if (!updatedUser.isProfileComplete) {
      updatedUser.isProfileComplete = !!(
        updatedUser.name &&
        updatedUser.email &&
        (updatedUser.avatar || updatedUser.profileImageUrl) &&
        updatedUser.notificationPreference
      );
      await updatedUser.save({ validateBeforeSave: false }); // skip full validation if needed
    }

    // Prepare clean response
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
        message: 'Duplicate value detected (likely email)',
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