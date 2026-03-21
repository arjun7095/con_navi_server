function buildSessionNotificationData(session, conflictType, extras = {}) {
  const step =
    typeof session.currentStep === 'number'
      ? session.currentStep
      : getPostConflictCurrentStep(session);

  return {
    type: 'session_navigation',
    conflictType,
    sessionId: session._id.toString(),
    status: session.status,
    currentStep: String(step),
    routeScreen: conflictType === 'live' ? 'LiveConflictSession' : 'PostConflictSession',
    ...extras,
  };
}

function getPostConflictCurrentStep(session) {
  if (!session.step1) return 1;
  if (!session.step2) return 2;
  if (!session.step3) return 3;
  if (!session.step4) return 4;
  if (!session.step5) return 5;
  return 5;
}

function serializeNotificationData(data = {}) {
  return Object.entries(data).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) {
      return acc;
    }

    acc[key] = typeof value === 'string' ? value : String(value);
    return acc;
  }, {});
}

module.exports = {
  buildSessionNotificationData,
  getPostConflictCurrentStep,
  serializeNotificationData,
};
