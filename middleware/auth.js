// middleware/auth.js
const jwt = require('jsonwebtoken');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Not authorized, no token' });
  }

  // ADD THIS CHECK
  if (!process.env.JWT_ACCESS_SECRET) {
    console.error('JWT_SECRET is missing in .env');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = {
      userId: decoded.userId,
      mobile: decoded.mobile,
      role: decoded.role
    };
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
};

module.exports = protect;