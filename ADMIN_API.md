# ConNavi Admin API - Final Endpoint Reference

Base URL: `http://localhost:5000/api`

All endpoints below require:
- Header: `Authorization: Bearer <accessToken>`
- Token user role must be `admin`

---

## 1. Admin Self

### GET `/api/admin/me`
Returns authenticated admin profile.

Response (200)
```json
{
  "success": true,
  "data": {
    "admin": {
      "userId": "664abc123def456",
      "countryCode": "+91",
      "mobile": "9876543210",
      "role": "admin",
      "name": "John Admin",
      "email": "john@example.com",
      "avatar": "https://...",
      "profileImageUrl": "https://...",
      "notificationPreference": "all",
      "dataAnalyticsEnabled": true,
      "isProfileComplete": true,
      "lastLogin": "2026-04-10T08:23:00.000Z",
      "createdAt": "2026-01-15T10:00:00.000Z",
      "updatedAt": "2026-04-20T09:15:00.000Z"
    }
  }
}
```

### PUT `/api/admin/me`
Updates admin profile.

Payload
```json
{
  "name": "John Admin",
  "email": "john@example.com",
  "avatar": "https://...",
  "profileImageUrl": "https://...",
  "notificationPreference": "important",
  "dataAnalyticsEnabled": false
}
```

Response (200)
```json
{
  "success": true,
  "message": "Admin details updated successfully",
  "data": {
    "admin": {
      "userId": "664abc123def456",
      "name": "John Admin"
    }
  }
}
```

### DELETE `/api/admin/me`
Deletes authenticated admin account.

Response (200)
```json
{
  "success": true,
  "message": "Admin account deleted successfully"
}
```

---

## 2. Overview

### GET `/api/admin/overview`
Optional query params:
- `startDate` (ISO date)
- `endDate` (ISO date)

Response (200)
```json
{
  "success": true,
  "data": {
    "users": {
      "total": 120,
      "activeLast30Days": 84,
      "inactive": 36
    },
    "sessions": {
      "live": { "total": 310, "completed": 220, "paused": 45, "abandoned": 45 },
      "post": { "total": 198, "completed": 150, "paused": 28, "abandoned": 20 },
      "combined": { "total": 508, "completed": 370, "paused": 73, "abandoned": 65 }
    },
    "filters": {
      "startDate": "2026-01-01",
      "endDate": "2026-03-31"
    }
  }
}
```

---

## 3. Users

### GET `/api/admin/users`
Query params:
- `search`
- `page` (default `1`)
- `limit` (default `20`)
- `profileComplete` (`true`/`false`)
- `sortBy` (`lastLogin` or `createdAt`)

Response (200)
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "_id": "664abc123def456",
        "name": "John Doe",
        "mobile": "9876543210",
        "email": "john@example.com",
        "role": "user",
        "isProfileComplete": true,
        "lastLogin": "2026-04-10T08:23:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10,
    "pages": 1
  }
}
```

### GET `/api/admin/users/:userId`
Optional query params:
- `startDate`
- `endDate`

Response (200)
```json
{
  "success": true,
  "data": {
    "user": { "_id": "664abc123def456", "name": "John Doe" },
    "sessionStats": {
      "live": { "total": 12, "completed": 9, "paused": 2, "abandoned": 1, "active": 0 },
      "post": { "total": 7, "completed": 5, "paused": 1, "abandoned": 1, "active": 0 },
      "combined": { "total": 19, "completed": 14, "paused": 3, "abandoned": 2, "active": 0 }
    },
    "totalSessions": 19,
    "allLiveSessions": [],
    "allPostSessions": [],
    "filters": {
      "startDate": "2026-01-01",
      "endDate": "2026-03-31"
    }
  }
}
```

---

## 4. Analytics

### GET `/api/admin/analytics/time`
Query params:
- `userId` (optional)
- `startDate` (optional)
- `endDate` (optional)
- `sessionType` (`live` or `post`, optional)

Response (200)
```json
{
  "success": true,
  "data": {
    "live": {
      "busiestDays": [{ "day": "Monday", "count": 48 }],
      "busiestHours": [{ "hour": 20, "label": "20:00", "count": 35 }],
      "monthlyTrend": [{ "year": 2026, "month": 3, "count": 95 }],
      "total": 310
    },
    "post": {
      "busiestDays": [{ "day": "Tuesday", "count": 21 }],
      "busiestHours": [{ "hour": 10, "label": "10:00", "count": 12 }],
      "monthlyTrend": [{ "year": 2026, "month": 3, "count": 44 }],
      "total": 198
    }
  }
}
```

### GET `/api/admin/analytics/sessions`
Query params:
- `userId` (optional)
- `startDate` (optional)
- `endDate` (optional)
- `sessionType` (`live` or `post`, optional)

Response (200)
```json
{
  "success": true,
  "data": {
    "live": {
      "statusBreakdown": { "total": 310, "completed": 220, "paused": 45, "abandoned": 45, "active": 0 },
      "feelings": {
        "present": [{ "value": "angry", "count": 87 }],
        "desired": [{ "value": "calm", "count": 95 }]
      },
      "needs": [{ "value": "respect", "count": 40 }],
      "keywords": {
        "speaking": [{ "word": "respect", "count": 42 }],
        "listening": [{ "word": "trust", "count": 24 }],
        "combined": [{ "word": "respect", "count": 55 }]
      }
    },
    "post": {
      "statusBreakdown": { "total": 198, "completed": 150, "paused": 28, "abandoned": 20, "active": 0 },
      "feelings": {
        "present": [{ "value": "afraid", "count": 25 }],
        "desired": [{ "value": "safe", "count": 19 }]
      },
      "needs": [{ "value": "clarity", "count": 11 }],
      "keywords": [{ "word": "understanding", "count": 30 }]
    }
  }
}
```

### GET `/api/admin/analytics/duration`
Query params:
- `userId` (optional)
- `startDate` (optional)
- `endDate` (optional)
- `sessionType` (`live` or `post`, optional)

Response (200)
```json
{
  "success": true,
  "data": {
    "live": {
      "overallAverageMinutes": 38,
      "userAverageMinutes": 45,
      "totalCompletedSessionsConsidered": 9,
      "sessions": [
        {
          "sessionId": "665b...",
          "startedAt": "2026-03-05T10:00:00.000Z",
          "completedAt": "2026-03-05T10:42:00.000Z",
          "totalDurationMinutes": 42,
          "currentStep": 12,
          "status": "completed"
        }
      ],
      "stepDurationInsights": [
        {
          "step": "conversation_cycle_count",
          "value": 24
        }
      ]
    }
  },
  "filters": {
    "userId": "664abc123def456",
    "startDate": "2026-01-01",
    "endDate": "2026-03-31",
    "sessionType": "live"
  }
}
```

---

## 5. Monthly Report Settings

### GET `/api/admin/settings/monthly-report`
Response (200)
```json
{
  "success": true,
  "data": {
    "monthlyReport": {
      "autoSendEnabled": true,
      "title": "Your I Feel Heard Monthly Trend Report",
      "bodyTemplate": "Hi {name}! Last month you started {total} sessions.",
      "sendPush": true,
      "sendEmail": true,
      "lastRunForMonth": "2026-03",
      "lastRunAt": "2026-04-01T09:00:00.000Z"
    }
  }
}
```

### PUT `/api/admin/settings/monthly-report`
Payload (all optional)
```json
{
  "autoSendEnabled": true,
  "title": "Your I Feel Heard Monthly Trend Report",
  "bodyTemplate": "Hi {name}! Last month: total={total}, completed={completed}, paused={paused}.",
  "sendPush": true,
  "sendEmail": true
}
```

Response (200)
```json
{
  "success": true,
  "message": "Monthly report settings updated",
  "data": {
    "monthlyReport": {
      "autoSendEnabled": true,
      "title": "Your I Feel Heard Monthly Trend Report",
      "bodyTemplate": "Hi {name}! Last month: total={total}, completed={completed}, paused={paused}.",
      "sendPush": true,
      "sendEmail": true
    }
  }
}
```

---

## 6. Notifications

### POST `/api/admin/notifications/send`
Single-user payload
```json
{
  "userId": "664abc123def456",
  "title": "Your trend update",
  "body": "Here is your latest summary.",
  "includeReport": true,
  "sessionIds": ["665b11111111111111111111"],
  "includeAllSessions": false
}
```

When `includeReport=true`, notification `data` now includes:
- `live_session_count`
- `post_session_count`
- `live_sessions` (JSON string of all live sessions for the user)
- `post_sessions` (JSON string of all post sessions for the user)

Selection behavior:
- If `sessionIds` contains one ID: sends that single session (live or post, whichever matches).
- If `sessionIds` contains multiple IDs: sends only those matched sessions.
- If `includeAllSessions=true`: ignores `sessionIds` and sends all user sessions.

Broadcast payload
```json
{
  "audience": "all",
  "title": "Service update",
  "body": "We released improvements today."
}
```

Response (200, single)
```json
{
  "success": true,
  "message": "Notification sent",
  "result": {
    "successCount": 1,
    "failureCount": 0,
    "failedTokensCount": 0
  }
}
```

Response (200, broadcast)
```json
{
  "success": true,
  "message": "Broadcast notification sent",
  "result": {
    "audience": "all",
    "totalUsers": 84,
    "successCount": 80,
    "failureCount": 4
  }
}
```

### POST `/api/admin/notifications/monthly`
Triggers immediate monthly dispatch to all users.

Testing scheduler note:
- Auto-dispatch cron default is currently every 2 minutes (`*/2 * * * *`) for testing.
- You can override using env `ADMIN_MONTHLY_REPORT_CRON`.
- For production monthly run, set it back to `0 9 1 * *` (1st day of month at 09:00).

Payload
```json
{
  "title": "Your I Feel Heard Monthly Trend Report",
  "bodyTemplate": "Hi {name}! total={total}, completed={completed}, paused={paused}, unresolved={unresolved}.",
  "sendPush": true,
  "sendEmail": true
}
```

Response (200)
```json
{
  "success": true,
  "message": "Monthly reports dispatched to 84 users",
  "title": "Your I Feel Heard Monthly Trend Report",
  "period": {
    "startDate": "2026-03-01T00:00:00.000Z",
    "endDate": "2026-03-31T23:59:59.000Z",
    "monthKey": "2026-03"
  },
  "summary": {
    "totalUsers": 84,
    "push": { "enabled": true, "successCount": 80, "failureCount": 4 },
    "email": { "enabled": true, "successCount": 72, "failureCount": 12 }
  }
}
```

---

## 7. Email

### POST `/api/admin/email/send`
Single-user payload
```json
{
  "userId": "664abc123def456",
  "subject": "Follow up",
  "message": "Hi John, here is your update."
}
```

Broadcast payload
```json
{
  "audience": "all",
  "subject": "Platform Update",
  "message": "Hello everyone, here is the latest update."
}
```

Response (200, single)
```json
{
  "success": true,
  "message": "Email sent to john@example.com"
}
```

Response (200, broadcast)
```json
{
  "success": true,
  "message": "Broadcast email sent",
  "result": {
    "audience": "all",
    "totalUsers": 120,
    "successCount": 118,
    "failureCount": 2
  }
}
```

---

## Common Errors

- `401` Missing/invalid token
- `403` Non-admin token
- `404` User/Admin not found
- `500` Server error
