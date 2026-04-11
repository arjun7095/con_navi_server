const { auth } = require('../config/firebase');
const User = require('../models/User');
const { generateTokens } = require('../utils/jwt');

// Phone numbers that are pre-approved as admins (comma-separated in ADMIN_WHITELIST env var)
// e.g. ADMIN_WHITELIST=+919876543210,+919876543211
const getAdminWhitelist = () =>
  (process.env.ADMIN_WHITELIST || '')
    .split(',')
    .map(n => n.trim())
    .filter(Boolean);

exports.verifyPhoneAndRole = async (req, res) => {
  const { idToken, role, fcmToken } = req.body;

  // Basic input validation
  if (!idToken) {
    return res.status(400).json({ success: false, message: "idToken is required" });
  }
  // role is optional when the phone is on the admin whitelist; otherwise required
  if (role && !['user', 'admin', 'moderator'].includes(role)) {
    return res.status(400).json({ success: false, message: "Valid role: user, admin, or moderator" });
  }

  // Quick format sanity check (helps debug wrong token type early)
  if (typeof idToken !== 'string' || !idToken.startsWith('eyJ')) {
    console.error('Invalid idToken format – does not look like JWT');
    return res.status(400).json({
      success: false,
      message: "Invalid idToken format – expected Firebase Auth JWT starting with 'eyJ...'"
    });
  }

  try {
    console.log('[DEBUG] Verifying token... length:', idToken.length);

    const decoded = await auth.verifyIdToken(idToken);

    console.log('[DEBUG] Token verified. UID:', decoded.uid);

    const firebaseUid = decoded.uid;
    const phoneNumber = decoded.phone_number; // e.g. +919876543210

    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: "Phone number not found in token" });
    }

    // Parse country code + mobile
    const countryCode = phoneNumber.startsWith('+') 
      ? phoneNumber.substring(0, phoneNumber.indexOf(phoneNumber.match(/\d/)[0])) 
      : '+';
    const mobile = phoneNumber.replace(countryCode, '');

    // Auto-detect admin: if the full phone number is in the whitelist, force role to 'admin'
    const adminWhitelist = getAdminWhitelist();
    const isWhitelistedAdmin = adminWhitelist.includes(phoneNumber);
    const resolvedRole = isWhitelistedAdmin ? 'admin' : (role || 'user');

    if (!isWhitelistedAdmin && !role) {
      return res.status(400).json({ success: false, message: "role is required (user or moderator)" });
    }

    let user = await User.findOne({ $or: [{ firebaseUid }, { mobile }] });
    let isNewUser = false;

    if (!user) {
      user = new User({
        firebaseUid,
        countryCode,
        mobile,
        role: resolvedRole,
        lastLogin: new Date(),
        fcmTokens: fcmToken ? [fcmToken] : []
      });
      await user.save();
      isNewUser = true;
    } else {
      user.lastLogin = new Date();
      // If the number is on the whitelist, always enforce admin role
      if (isWhitelistedAdmin && user.role !== 'admin') {
        user.role = 'admin';
      }
      await user.save();
    }

    // Store/update FCM token
    if (fcmToken && !user.fcmTokens.includes(fcmToken)) {
      user.fcmTokens.push(fcmToken);
      await user.save();
    }

    const { accessToken, refreshToken } = generateTokens({
      userId: user._id.toString(),
      mobile: user.mobile,
      role: user.role,
    });

    // Optional: store refresh token in DB
    user.refreshToken = refreshToken;
    await user.save();

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const nextAction = isNewUser || !user.isProfileComplete
      ? 'CompleteProfile'
      : user.role === 'admin'
        ? 'AdminDashboard'
        : user.role === 'moderator'
          ? 'ModeratorDashboard'
          : 'UserDashboard';

    return res.json({
      success: true,
      message: isNewUser ? "Account created" : "Login successful",
      accessToken,
      user: {
        userId: user._id.toString(),
        countryCode: user.countryCode,
        mobile: user.mobile,
        role: user.role,
        name: user.name || null,
        email: user.email || null,
        avatar: user.avatar,
        profileImageUrl: user.profileImageUrl,
        notificationPreference: user.notificationPreference,
        dataAnalyticsEnabled: user.dataAnalyticsEnabled,
        isProfileComplete: user.isProfileComplete,
      },
      nextAction,
    });

  } catch (err) {
    console.error("Firebase verify error:", err.code || err.message, err);

    let status = 401;
    let message = "Invalid or expired token";

    if (err.code === 'auth/id-token-expired') {
      message = "Token has expired – please refresh and try again";
    } else if (err.code === 'auth/invalid-id-token') {
      message = "Invalid token format or signature";
    } else if (err.code === 'auth/argument-error') {
      message = "Token verification setup error (check service account)";
      status = 500;
    }

    return res.status(status).json({
      success: false,
      message,
      debug: process.env.NODE_ENV !== 'production' ? { code: err.code, error: err.message } : undefined
    });
  }
};


exports.createProfile = async (req, res) => {
  const { mobile } = req.user; // from JWT middleware

  const {
    name,
    email,
    avatar,          // base64 if you're sending it
    profileImageMime,
    notificationPreference,
    dataAnalyticsEnabled,
    profileImageUrl,
    // you can add more fields later: dob, gender, address, etc.
  } = req.body;

  try {
    // 1. Find the existing user (must exist after verifyOTP)
    const user = await User.findOne({ mobile });

    if (!user) {
      // This should almost never happen if verifyOTP is working correctly
      return res.status(404).json({
        success: false,
        message: "User not found. Please verify OTP again.",
      });
    }

    // 2. Optional: already complete check
    if (user.isProfileComplete) {
      return res.status(200).json({
        success: false,
        message: "Profile is already complete",
        isProfileComplete:user.isProfileComplete,
        nextStep:"Home Page"
      });
    }

    // 3. Prepare updates (only update provided fields)
    const updates = {};

    if (name !== undefined) updates.name = name.trim();
    if (email !== undefined) updates.email = email.trim().toLowerCase();
    if (avatar !== undefined) updates.avatar = avatar;
    if (profileImageMime !== undefined) updates.profileImageMime = profileImageMime;
    if (notificationPreference !== undefined) {
      if (['all', 'important', 'none'].includes(notificationPreference)) {
        updates.notificationPreference = notificationPreference;
      }
    }
    if (dataAnalyticsEnabled !== undefined) {
      updates.dataAnalyticsEnabled = !!dataAnalyticsEnabled;
    }
    if (profileImageUrl !== undefined) updates.profileImageUrl = profileImageUrl;

    // 4. Mark profile as complete
    updates.isProfileComplete = true;
    updates.updatedAt = new Date(); // optional

    // 5. Apply updates
    Object.assign(user, updates);
    await user.save();

    // 6. Return updated user data
    return res.status(200).json({
      success: true,
      message: "Profile completed successfully",
      user: {
        mobile: user.mobile,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        profileImage: user.profileImage ? "[Base64 content]" : null,
        profileImageMime: user.profileImageMime,
        notificationPreference: user.notificationPreference,
        dataAnalyticsEnabled: user.dataAnalyticsEnabled,
        profileImageUrl: user.profileImageUrl,
        role: user.role,
        isProfileComplete: user.isProfileComplete,
      },
    });
  } catch (error) {
    console.error("createProfile error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Conflict - duplicate value detected",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error while completing profile",
    });
  }
};

exports.updateProfile = async (req, res) => {
  const { mobile } = req.user;
  const updates = req.body;

  // Allowed fields (explicitly list to prevent unwanted changes)
  const allowedFields = [
    'name', 'email', 'avatar', 'profileImageMime',
    'notificationPreference', 'dataAnalyticsEnabled', 'profileImageUrl'
  ];

  const filteredUpdates = {};
  allowedFields.forEach(key => {
    if (updates[key] !== undefined) {
      filteredUpdates[key] = updates[key];
    }
  });

  // Optional: basic base64 check
  if (filteredUpdates.profileImageUrl && typeof filteredUpdates.profileImageUrl !== 'string') {
    return res.status(400).json({ success: false, message: 'profileImageUrl must be a base64 string' });
  }

  // Validate enum
  if (filteredUpdates.notificationPreference &&
      !['all', 'important', 'none'].includes(filteredUpdates.notificationPreference)) {
    return res.status(400).json({ success: false, message: 'Invalid notification preference' });
  }

  const user = await User.findOneAndUpdate({ mobile }, filteredUpdates, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  res.status(200).json({
    success: true,
    message: 'Profile updated',
    user: {
      mobile: user.mobile,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      profileImageMime: user.profileImageMime,
      notificationPreference: user.notificationPreference,
      dataAnalyticsEnabled: user.dataAnalyticsEnabled,
      profileImageUrl: user.profileImageUrl,
      role: user.role,
    },
  });
};
