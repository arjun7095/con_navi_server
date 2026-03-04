const { auth } = require('../config/firebase');
const User = require('../models/User');
const { generateTokens } = require('../utils/jwt');

exports.verifyPhoneAndRole = async (req, res) => {
  const { idToken, role, fcmToken } = req.body;

  if (!idToken) {
    return res.status(400).json({
      success: false,
      message: "idToken is required",
    });
  }

  try {
    // Verify Firebase token ONLY here
    const decoded = await auth.verifyIdToken(idToken);

    const firebaseUid = decoded.uid;
    const phoneNumber = decoded.phone_number;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Phone number not found in token",
      });
    }

    const countryCode = phoneNumber.startsWith("+")
      ? phoneNumber.slice(0, phoneNumber.length - 10)
      : "+";

    const mobile = phoneNumber.replace(countryCode, "");

    let user = await User.findOne({ firebaseUid });

    let isNewUser = false;

    if (!user) {
      user = new User({
        firebaseUid,
        countryCode,
        mobile,
        role: "user", // 🔒 NEVER trust frontend role
        lastLogin: new Date(),
      });

      isNewUser = true;
    } else {
      user.lastLogin = new Date();
    }

    if (fcmToken && !user.fcmTokens.includes(fcmToken)) {
      user.fcmTokens.push(fcmToken);
    }

    await user.save();

    const { accessToken, refreshToken } = generateTokens({
      userId: user._id.toString(),
      mobile: user.mobile,
      role: user.role,
    });

    user.refreshToken = refreshToken;
    await user.save();

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

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
      nextAction:
        isNewUser || !user.isProfileComplete
          ? "CompleteProfile"
          : "UserDashboard",
    });
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired Firebase token",
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