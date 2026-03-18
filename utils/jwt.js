// src/utils/jwt.js
const jwt = require("jsonwebtoken");

if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error("JWT secrets are not defined in environment variables");
}

const generateTokens = (payload) => {
  const accessToken = jwt.sign(
    { ...payload, type: "access", version: 1 },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: "30d" } // short-lived access token
  );

  const refreshToken = jwt.sign(
    { ...payload, type: "refresh", version: 1 },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" }
  );

  return { accessToken, refreshToken };
};

const verifyAccessToken = (token) => {
  const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

  if (decoded.type !== "access") {
    throw new Error("Invalid token type");
  }

  if (decoded.version !== 1) {
    throw new Error("Token version mismatch");
  }

  return decoded;
};

module.exports = { generateTokens, verifyAccessToken };
