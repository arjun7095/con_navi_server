// middleware/auth.js
const jwt = require("jsonwebtoken");

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized - no token provided",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // Reject Firebase tokens (RS256) automatically
    if (decoded.type !== "access") {
      return res.status(401).json({
        success: false,
        message: "Invalid token type",
      });
    }

    if (decoded.version !== 1) {
      return res.status(401).json({
        success: false,
        message: "Token expired - please login again",
      });
    }

    req.user = {
      userId: decoded.userId,
      mobile: decoded.mobile,
      role: decoded.role,
    };

    next();
  } catch (err) {
    let message = "Not authorized - invalid token";

    if (err.name === "TokenExpiredError") {
      message = "Session expired - please login again";
    }

    return res.status(401).json({
      success: false,
      message,
    });
  }
};

module.exports = protect;