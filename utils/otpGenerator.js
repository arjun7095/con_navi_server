// In production → use Redis or database with TTL
const otpStore = new Map(); // mobile → { otp: string, expiry: number }

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
};

const sendOTP = (mobile, otp) => {
  // TODO: Integrate Twilio / MSG91 / Firebase here
  console.log(`[OTP Service] To: ${mobile} | OTP: ${otp}`);
  // In real app: await twilioClient.messages.create({...})
};

const storeOTP = (mobile, otp) => {
  const expiry = Date.now() + 5 * 60 * 1000; // 5 min
  otpStore.set(mobile, { otp, expiry });
};

const verifyOTP = (mobile, otp) => {
  const data = otpStore.get(mobile);
  if (!data) return false;
  if (data.expiry < Date.now()) {
    otpStore.delete(mobile);
    return false;
  }
  if (data.otp !== otp) return false;

  otpStore.delete(mobile);
  return true;
};

module.exports = { generateOTP, sendOTP, storeOTP, verifyOTP };