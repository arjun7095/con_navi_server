const cron = require('node-cron');
const { runAutomatedMonthlyReportDispatch } = require('../controllers/adminController');

function startMonthlyAdminReportScheduler() {
  const cronExpression = process.env.ADMIN_MONTHLY_REPORT_CRON || '0 9 1 * *';

  cron.schedule(cronExpression, async () => {
    try {
      const result = await runAutomatedMonthlyReportDispatch();
      if (!result.skipped) {
        console.log('Monthly admin report auto-dispatch completed:', result.period?.monthKey);
      }
    } catch (err) {
      console.error('Monthly admin report auto-dispatch failed:', err.message);
    }
  });
}

module.exports = startMonthlyAdminReportScheduler;
