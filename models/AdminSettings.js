const mongoose = require('mongoose');

const adminSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'default',
    },
    monthlyReport: {
      autoSendEnabled: { type: Boolean, default: false },
      title: {
        type: String,
        default: 'Your I Feel Heard Monthly Trend Report',
      },
      bodyTemplate: { type: String, default: '' },
      sendPush: { type: Boolean, default: true },
      sendEmail: { type: Boolean, default: true },
      lastRunForMonth: { type: String, default: null },
      lastRunAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminSettings', adminSettingsSchema);
