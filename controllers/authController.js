const User = require('../models/User');
const jwt = require('jsonwebtoken');
const OTP=require('../models/OTP')
const { generateTokens } = require('../utils/jwt');
// const { generateOTP, sendOTP, storeOTP, verifyOTP } = require('../utils/otpGenerator');

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
exports.sendOTP = async (req, res) => {
  const { countryCode, mobile,role } = req.body;

  if (!countryCode || !mobile || !role) {
    return res.status(400).json({ error: "All fields required", otpStatus: false });
  }
  if (!/^\d{10}$/.test(mobile)) {
    return res.status(400).json({ error: "Mobile must be 10 digits", otpStatus: false });
  }
  if (!/^\+\d{1,3}$/.test(countryCode)) {
    return res.status(400).json({ error: "Invalid country code", otpStatus: false });
  }
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: "Role must be 'user' or 'admin'", otpStatus: false });
  }

  try {
        
    // Reuse recent OTP (same OTP model for both)
    const recent = await OTP.findOne({ mobile, role, expiresAt: { $gt: new Date() } });
    if (recent) {
      return res.json({
        countryCode, mobile, role,
        otp: recent.otp, // Remove in production
        message: "OTP already sent",
        otpStatus: true
      });
    }

    const otp = generateOTP();
    await OTP.create({ countryCode, mobile, role, otp });

    console.log(`OTP → ${mobile} (${role}): ${otp}`);

    return res.json({
      countryCode, mobile, role,
      otp, // Remove in production
      message: "OTP sent successfully",
      otpStatus: true
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error", otpStatus: false });
  }
};

exports.verifyOTP = async (req, res) => {
  const { countryCode, mobile, role, otp } = req.body;

  // 1. Basic input validation
  if (!countryCode || !mobile || !role || !otp) {
    return res.status(400).json({
      otpStatus: false,
      error: "countryCode, mobile, role and otp are all required",
    });
  }

  try {
    // 2. Find the most recent OTP for this combination
    const storedOTP = await OTP.findOne({ countryCode, mobile, role })
      .sort({ createdAt: -1 })
      .exec();

    if (!storedOTP) {
      return res.status(401).json({
        otpStatus: false,
        error: "No OTP found for this number and role",
      });
    }

    if (storedOTP.expiresAt < new Date()) {
      await OTP.deleteOne({ _id: storedOTP._id }); // clean up expired
      return res.status(401).json({
        otpStatus: false,
        error: "OTP has expired",
      });
    }

    if (storedOTP.otp !== otp) {
      return res.status(401).json({
        otpStatus: false,
        error: "Invalid OTP",
      });
    }

    // 3. OTP is valid → delete it immediately (one-time use)
    await OTP.deleteOne({ _id: storedOTP._id });

    // 4. Check if user already exists
    let user = await User.findOne({ mobile });

// If needed: also validate countryCode matches (extra safety)
if (user && user.countryCode !== countryCode) {
  return res.status(409).json({
    otpStatus: false,
    error: "Mobile number already registered with different country code",
  });
}

let isNewUser = false;

if (!user) {
  user = new User({
    countryCode,
    mobile,
    role,
    isProfileComplete: false,
  });
  await user.save();
  isNewUser = true;
}

    // 5. Generate tokens
    const payload = {
      userId: user._id.toString(),
      mobile: user.mobile,
      role: user.role,
    };

    const { accessToken, refreshToken } = generateTokens(payload);

    // Save refresh token to user
    user.refreshToken = refreshToken;
    await user.save();

    // 6. Set refresh token in httpOnly cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // 7. Decide next action / screen
    let nextAction = "UserDashboard"; // default for existing users

    if (isNewUser || !user.isProfileComplete) {
      nextAction = "CompleteProfile";
    }

    // 8. Prepare safe user response (never send sensitive fields)
    const userResponse = {
      userId: user._id.toString(),
      countryCode: user.countryCode,
      mobile: user.mobile,
      role: user.role,
      name: user.name || null,
      email: user.email || null,
      isProfileComplete: !!user.isProfileComplete,
      // avatar, profileImage, etc. — add if needed
    };

    // 9. Final success response
    return res.status(200).json({
      otpStatus: true,
      message: isNewUser ? "Account created successfully" : "Login successful",
      accessToken,
      user: userResponse,
      nextAction,
    });
  } catch (err) {
    console.error("verifyOTP error:", err);

    if (err.code === 11000) {
      return res.status(409).json({
        otpStatus: false,
        error: "Account conflict - please try again or contact support",
      });
    }

    return res.status(500).json({
      otpStatus: false,
      error: "Internal server error",
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