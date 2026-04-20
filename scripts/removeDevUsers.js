require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');
const User = require('../models/User');
const LiveConflictSession = require('../models/LiveConflictSession');
const PostConflictSession = require('../models/PostConflictSession');

function parseArgs(argv) {
  const args = argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isYes = args.includes('--yes');
  const isInteractive = args.includes('--interactive');

  const mobiles = args
    .filter(arg => !arg.startsWith('--'))
    .map(m => m.trim())
    .filter(Boolean);

  return { mobiles, isDryRun, isYes, isInteractive };
}

async function connectDb() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing in environment variables');
  }
  await mongoose.connect(process.env.MONGO_URI);
}

async function summarizeTargets(mobiles) {
  const users = await User.find({ mobile: { $in: mobiles } }).select('_id mobile role name email');
  const userIds = users.map(u => u._id);

  const [liveCount, postCount] = await Promise.all([
    LiveConflictSession.countDocuments({ userId: { $in: userIds } }),
    PostConflictSession.countDocuments({ userId: { $in: userIds } }),
  ]);

  return { users, liveCount, postCount };
}

async function getAllUsersForSelection() {
  return User.find({})
    .select('_id mobile role name email createdAt')
    .sort({ createdAt: -1 });
}

async function deleteTargets(userIds) {
  const [liveResult, postResult, userResult] = await Promise.all([
    LiveConflictSession.deleteMany({ userId: { $in: userIds } }),
    PostConflictSession.deleteMany({ userId: { $in: userIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);

  return {
    deletedLiveSessions: liveResult.deletedCount || 0,
    deletedPostSessions: postResult.deletedCount || 0,
    deletedUsers: userResult.deletedCount || 0,
  };
}

function createPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question) => new Promise(resolve => rl.question(question, resolve));
  const close = () => rl.close();
  return { ask, close };
}

function parseMobilesInput(input) {
  return input
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);
}

function printUserList(users) {
  console.log('\nAll users:\n');
  users.forEach((user, index) => {
    console.log(
      `${index + 1}. ${user.mobile} | ${user.role} | ${user.name || 'N/A'} | ${user.email || 'N/A'}`
    );
  });
  console.log('');
}

async function interactiveSelection() {
  const users = await getAllUsersForSelection();
  if (!users.length) {
    return { mobiles: [], isDryRun: false, isYes: false };
  }

  printUserList(users);
  const { ask, close } = createPrompt();

  try {
    const input = await ask('Enter mobile numbers to delete (comma separated): ');
    const selectedMobiles = parseMobilesInput(input);
    if (!selectedMobiles.length) {
      return { mobiles: [], isDryRun: false, isYes: false };
    }

    const preview = await summarizeTargets(selectedMobiles);
    console.log('\nSelected users:', preview.users.length);
    preview.users.forEach(user => {
      console.log(`- ${user.mobile} | ${user.role} | ${user.name || 'N/A'} | ${user.email || 'N/A'}`);
    });
    console.log('Live sessions to delete:', preview.liveCount);
    console.log('Post sessions to delete:', preview.postCount);

    const confirmation = (await ask('\nType DELETE to confirm: ')).trim();
    return {
      mobiles: selectedMobiles,
      isDryRun: false,
      isYes: confirmation === 'DELETE',
    };
  } finally {
    close();
  }
}

async function run() {
  let { mobiles, isDryRun, isYes, isInteractive } = parseArgs(process.argv);

  if (!mobiles.length && !isInteractive) {
    isInteractive = true;
  }

  await connectDb();

  if (isInteractive) {
    const selection = await interactiveSelection();
    mobiles = selection.mobiles;
    isDryRun = selection.isDryRun;
    isYes = selection.isYes;
  }

  if (!mobiles.length) {
    console.log('No mobile numbers selected. Exiting without changes.');
    return;
  }

  const { users, liveCount, postCount } = await summarizeTargets(mobiles);
  const foundMobiles = new Set(users.map(u => u.mobile));
  const missingMobiles = mobiles.filter(m => !foundMobiles.has(m));

  console.log('Matched users:', users.length);
  users.forEach(user => {
    console.log(`- ${user.mobile} | ${user.role} | ${user.name || 'N/A'} | ${user.email || 'N/A'}`);
  });

  if (missingMobiles.length) {
    console.log('Not found mobiles:', missingMobiles.join(', '));
  }

  console.log('Live sessions to delete:', liveCount);
  console.log('Post sessions to delete:', postCount);

  if (isDryRun || !isYes) {
    console.log('No data deleted.');
    if (!isInteractive) {
      console.log('Run with --yes to execute deletion.');
    }
    return;
  }

  if (!users.length) {
    console.log('No matching users found. Nothing deleted.');
    return;
  }

  const results = await deleteTargets(users.map(u => u._id));
  console.log('Deletion completed:', results);
}

run()
  .catch(err => {
    console.error('Cleanup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (_) {
      // Ignore disconnect errors on exit.
    }
  });
