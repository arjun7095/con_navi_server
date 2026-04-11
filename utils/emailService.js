const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send a simple email
 * @param {object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text body
 * @param {string} [options.html] - HTML body (optional, falls back to text)
 */
const sendEmail = async ({ to, subject, text, html }) => {
  const info = await transporter.sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'ConNavi Admin'}" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html: html || `<p>${text.replace(/\n/g, '<br>')}</p>`,
  });
  return info;
};

module.exports = { sendEmail };
