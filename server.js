require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const startWeeklyConflictReminder = require('./utils/weeklyConflictReminder');
const { startInterruptedConflictReminder } = require('./utils/interruptedConflictReminder');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Connect DB
connectDB();
startWeeklyConflictReminder();
startInterruptedConflictReminder();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/post-conflicts', require('./routes/postConflictRoutes'));
app.use('/api/live-conflicts', require('./routes/liveConflictRoutes'));
app.use('/api/profiles', require('./routes/profileRoutes'));

// Root route (optional)
app.get('/', (req, res) => res.send('Backend Running'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});
