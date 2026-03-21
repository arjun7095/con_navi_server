const CONFLICT_SESSION_STATUS = Object.freeze({
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned',
});

const RESUMABLE_CONFLICT_STATUSES = [
  CONFLICT_SESSION_STATUS.ACTIVE,
  CONFLICT_SESSION_STATUS.PAUSED,
];

const isResumableConflictStatus = (status) =>
  RESUMABLE_CONFLICT_STATUSES.includes(status);

module.exports = {
  CONFLICT_SESSION_STATUS,
  RESUMABLE_CONFLICT_STATUSES,
  isResumableConflictStatus,
};
