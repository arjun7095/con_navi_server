// middleware/auth.js
const jwt = require('jsonwebtoken');

const protect = async (req, res, next) => {
  let token;

  // 1. Support multiple common Authorization header formats
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.accessToken) {           // optional: support cookie-based tokens
    token = req.cookies.accessToken;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized - no token provided',
    });
  }

  // 2. Check for missing secret early (good you already have this)
  if (!process.env.JWT_ACCESS_SECRET) {
    console.error('[CRITICAL] JWT_ACCESS_SECRET is missing in environment variables');
    return res.status(500).json({
      success: false,
      message: 'Server configuration error - contact support',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // 3. Optional: check token type / issued at / other claims if needed
    // if (decoded.type !== 'access') {
    //   return res.status(401).json({ success: false, message: 'Invalid token type' });
    // }

    // 4. Attach minimal user info to req.user (avoid attaching sensitive data)
    req.user = {
      userId: decoded.userId,
      mobile: decoded.mobile,
      role: decoded.role || 'user',   // fallback if role missing
    };

    next();
  } catch (err) {
    console.error('JWT verification failed:', {
      error: err.name,
      message: err.message,
      token: token.substring(0, 20) + '...', // partial for logging safety
    });

    let status = 401;
    let message = 'Not authorized - invalid token';

    if (err.name === 'TokenExpiredError') {
      message = 'Session expired - please log in again';
      status = 401;
    } else if (err.name === 'JsonWebTokenError') {
      message = 'Invalid token signature';
    } else if (err.name === 'NotBeforeError') {
      message = 'Token not yet valid';
    }

    return res.status(status).json({
      success: false,
      message,
      errorCode: err.name,   // helpful for frontend debugging
    });
  }
};

module.exports = protect;