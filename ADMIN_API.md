# ConNavi Admin API — Endpoint Reference

Base URL: `http://localhost:5000/api`

All admin endpoints require the header:
```
Authorization: Bearer <accessToken>
```
The `accessToken` is obtained from the login endpoint. The token must belong to a user with `role: "admin"`.

---

## AUTH — Login (shared for all roles)

### POST /api/auth/verify-phone

Verifies a Firebase phone OTP token and returns a JWT.  
If the phone number is in `ADMIN_WHITELIST`, the role is automatically forced to `"admin"` — the frontend does not need to send `role` for admin users.

**Request Body**
```json
{
  "idToken": "eyJhbGciOiJSUzI1...",
  "role": "user",
  "fcmToken": "fcm_device_token_here"
}
```
- `idToken` — Firebase Auth ID token from phone OTP (required)
- `role` — `"user"` or `"moderator"` (optional for whitelisted admin phones; required for regular users)
- `fcmToken` — device FCM token for push notifications (optional)

**Response — Success (200)**
```json
{
  "success": true,
  "message": "Login successful",
  "accessToken": "eyJhbGciOiJIUzI1...",
  "user": {
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
    "isProfileComplete": true
  },
  "nextAction": "AdminDashboard"
}
```

**`nextAction` values**
| Value | Meaning |
|---|---|
| `"AdminDashboard"` | Logged-in user is admin with complete profile → go to admin panel |
| `"ModeratorDashboard"` | Moderator role |
| `"UserDashboard"` | Regular user |
| `"CompleteProfile"` | New user or profile not yet completed |

**Response — Unauthorized (401)**
```json
{
  "success": false,
  "message": "Invalid or expired token"
}
```

---

## ADMIN ENDPOINTS

> All routes below: `Authorization: Bearer <admin_accessToken>` required.  
> Non-admin tokens receive `403 Admin access required`.

---

### 1. GET /api/admin/me

Returns the authenticated admin's own profile details.

**Query Params:** none

**Response (200)**
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

---

### 2. PUT /api/admin/me

Updates the authenticated admin's own account details.

**Request Body**
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

**Allowed fields**
| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | No | Must be a non-empty string |
| `email` | string | No | Must be a valid email |
| `avatar` | string | No | Accepts image URL or base64 string |
| `profileImageUrl` | string | No | Accepts image URL or base64 string |
| `notificationPreference` | string | No | `all`, `important`, or `none` |
| `dataAnalyticsEnabled` | boolean | No | Enable or disable analytics collection |

**Response (200)**
```json
{
  "success": true,
  "message": "Admin details updated successfully",
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
      "notificationPreference": "important",
      "dataAnalyticsEnabled": false,
      "isProfileComplete": true,
      "lastLogin": "2026-04-10T08:23:00.000Z",
      "createdAt": "2026-01-15T10:00:00.000Z",
      "updatedAt": "2026-04-20T09:20:00.000Z"
    }
  }
}
```

**Response - Validation Error (400)**
```json
{
  "success": false,
  "message": "Invalid notificationPreference value"
}
```

---

### 3. DELETE /api/admin/me

Deletes the authenticated admin account itself.

**Query Params:** none

**Response (200)**
```json
{
  "success": true,
  "message": "Admin account deleted successfully"
}
```

---

### 4. GET /api/admin/overview

Dashboard summary — total users, active users, session counts.

**Query Params:** none

**Response (200)**
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
      "live": {
        "total": 310,
        "completed": 220,
        "paused": 45,
        "abandoned": 45
      },
      "post": {
        "total": 198,
        "completed": 150,
        "paused": 28,
        "abandoned": 20
      },
      "combined": {
        "total": 508,
        "completed": 370,
        "paused": 73,
        "abandoned": 65
      }
    }
  }
}
```

---

### 5. GET /api/admin/users

Paginated user list with optional search and filters.

**Query Params**
| Param | Type | Default | Description |
|---|---|---|---|
| `search` | string | `""` | Search by name, mobile, or email |
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Users per page |
| `profileComplete` | boolean | — | Filter by `true` or `false` |
| `sortBy` | string | `lastLogin` | `lastLogin` or `createdAt` |

**Example**
```
GET /api/admin/users?search=john&page=1&limit=10&profileComplete=true
```

**Response (200)**
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
        "avatar": "https://...",
        "role": "user",
        "isProfileComplete": true,
        "lastLogin": "2026-04-10T08:23:00.000Z",
        "createdAt": "2026-01-15T10:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10,
    "pages": 1
  }
}
```

---

### 6. GET /api/admin/users/:userId

Full detail for a single user including session stats and all sessions.

**URL Params**
| Param | Description |
|---|---|
| `userId` | MongoDB `_id` of the user |

**Example**
```
GET /api/admin/users/664abc123def456
```

**Response (200)**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "664abc123def456",
      "name": "John Doe",
      "mobile": "9876543210",
      "countryCode": "+91",
      "email": "john@example.com",
      "role": "user",
      "avatar": "https://...",
      "profileImageUrl": "https://...",
      "notificationPreference": "all",
      "dataAnalyticsEnabled": true,
      "isProfileComplete": true,
      "lastLogin": "2026-04-10T08:23:00.000Z",
      "createdAt": "2026-01-15T10:00:00.000Z"
    },
    "sessionStats": {
      "live": {
        "total": 12,
        "completed": 9,
        "paused": 2,
        "abandoned": 1,
        "active": 0
      },
      "post": {
        "total": 7,
        "completed": 5,
        "paused": 1,
        "abandoned": 1,
        "active": 0
      },
      "combined": {
        "total": 19,
        "completed": 14,
        "paused": 3,
        "abandoned": 2,
        "active": 0
      }
    },
    "totalSessions": 19,
    "allLiveSessions": [ /* all live sessions for this user */ ],
    "allPostSessions": [ /* all post sessions for this user */ ]
  }
}
```

**Response — Not Found (404)**
```json
{
  "success": false,
  "message": "User not found"
}
```

---

### 7. GET /api/admin/analytics/time

Time-based usage analytics — busiest days, busiest hours, monthly trend.  
Works for all users combined or filtered to one specific user.

**Query Params**
| Param | Type | Description |
|---|---|---|
| `userId` | string | (optional) Filter to a single user's sessions |
| `startDate` | ISO date | (optional) e.g. `2026-01-01` |
| `endDate` | ISO date | (optional) e.g. `2026-04-11` |
| `sessionType` | string | (optional) `live` or `post`; omit for both |

**Example**
```
GET /api/admin/analytics/time?startDate=2026-01-01&endDate=2026-04-11&sessionType=live
GET /api/admin/analytics/time?userId=664abc123def456
```

**Response (200)**
```json
{
  "success": true,
  "data": {
    "live": {
      "busiestDays": [
        { "day": "Monday", "count": 48 },
        { "day": "Tuesday", "count": 41 },
        { "day": "Saturday", "count": 38 }
      ],
      "busiestHours": [
        { "hour": 20, "label": "20:00", "count": 35 },
        { "hour": 21, "label": "21:00", "count": 30 },
        { "hour": 9, "label": "09:00", "count": 22 }
      ],
      "monthlyTrend": [
        { "year": 2026, "month": 1, "count": 60 },
        { "year": 2026, "month": 2, "count": 72 },
        { "year": 2026, "month": 3, "count": 95 }
      ],
      "total": 310
    },
    "post": {
      "busiestDays": [ /* same shape */ ],
      "busiestHours": [ /* same shape */ ],
      "monthlyTrend": [ /* same shape */ ],
      "total": 198
    }
  }
}
```

---

### 8. GET /api/admin/analytics/sessions

Session analytics — status breakdown, feelings frequency, conflict keyword extraction.  
Keywords are extracted from conversation text (speaking/listening cycles for live sessions; step 3 reflections for post sessions). Common English words are filtered out automatically.

**Query Params**
| Param | Type | Description |
|---|---|---|
| `userId` | string | (optional) Limit to one user |
| `startDate` | ISO date | (optional) |
| `endDate` | ISO date | (optional) |
| `sessionType` | string | (optional) `live` or `post`; omit for both |

**Example**
```
GET /api/admin/analytics/sessions
GET /api/admin/analytics/sessions?userId=664abc123def456&sessionType=live
```

**Response (200)**
```json
{
  "success": true,
  "data": {
    "live": {
      "statusBreakdown": {
        "total": 310,
        "completed": 220,
        "paused": 45,
        "abandoned": 45,
        "active": 0
      },
      "feelings": {
        "present": [
          { "value": "angry", "count": 87 },
          { "value": "frustrated", "count": 64 },
          { "value": "hurt", "count": 51 }
        ],
        "desired": [
          { "value": "calm", "count": 95 },
          { "value": "understood", "count": 80 }
        ]
      },
      "keywords": {
        "speaking": [
          { "word": "respect", "count": 42 },
          { "word": "communication", "count": 38 },
          { "word": "boundary", "count": 31 }
        ],
        "listening": [
          { "word": "ignored", "count": 27 },
          { "word": "trust", "count": 24 }
        ],
        "combined": [
          { "word": "respect", "count": 55 },
          { "word": "communication", "count": 50 },
          { "word": "boundary", "count": 44 }
        ]
      }
    },
    "post": {
      "statusBreakdown": { /* same shape */ },
      "feelings": {
        "present": [ /* same shape */ ],
        "desired": [ /* same shape */ ]
      },
      "keywords": [
        { "word": "understanding", "count": 30 },
        { "word": "assumption", "count": 22 }
      ]
    }
  }
}
```

---

### 9. POST /api/admin/notifications/send

Send an on-demand push notification to a specific user.  
Optionally include the user's session stats as notification data payload (for the frontend to display).

**Request Body**
```json
{
  "userId": "664abc123def456",
  "title": "Your session report",
  "body": "Hi John, here's a summary of your conflict sessions.",
  "includeReport": true
}
```
| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | string | ✅ | Target user's MongoDB `_id` |
| `title` | string | ✅ | Notification title |
| `body` | string | ✅ | Notification body text |
| `includeReport` | boolean | ❌ | If `true`, attaches session counts as data payload |

**Response (200)**
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

**When `includeReport: true`** — notification data payload includes:
```json
{
  "type": "admin_report",
  "live_completed": "9",
  "live_paused": "2",
  "live_abandoned": "1",
  "post_completed": "5",
  "post_paused": "1",
  "post_abandoned": "1"
}
```

**Response — User has no FCM tokens (200)**
```json
{
  "success": true,
  "message": "Notification sent",
  "result": {
    "successCount": 0,
    "failureCount": 0,
    "failedTokensCount": 0,
    "message": "No tokens"
  }
}
```

---

### 10. POST /api/admin/notifications/monthly

Send personalised monthly summary push notifications to **all users** who have a registered device token.  
Stats are calculated from the **previous calendar month**.

**Request Body**
```json
{
  "title": "Your Monthly ConNavi Summary 📊",
  "bodyTemplate": "Hi {name}! Last month you started {total} session(s), completed {completed}, paused {paused}. Keep it up!"
}
```
| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | ✅ | Notification title sent to every user |
| `bodyTemplate` | string | ❌ | Custom message with placeholders (see below). If omitted, a default message is used. |

**`bodyTemplate` placeholders**
| Placeholder | Replaced with |
|---|---|
| `{name}` | User's name |
| `{total}` | Total sessions (live + post) in the previous month |
| `{completed}` | Total completed sessions |
| `{paused}` | Total paused sessions |
| `{liveSessions}` | Live sessions started |
| `{postSessions}` | Post sessions started |
| `{liveCompleted}` | Live sessions completed |
| `{postCompleted}` | Post sessions completed |

**Response (200)**
```json
{
  "success": true,
  "message": "Monthly notifications dispatched to 84 users",
  "summary": {
    "totalUsers": 84,
    "successCount": 80,
    "failureCount": 4
  }
}
```

---

### 11. POST /api/admin/email/send

Send a plain email (written by admin) to a specific user. No session data is included — the content is entirely what the admin types.

> ⚠️ The user must have an email address saved in their profile. If not, a `400` is returned.

**Request Body**
```json
{
  "userId": "664abc123def456",
  "subject": "Following up on your account",
  "message": "Hi John,\n\nWe noticed you haven't completed a session in a while.\nFeel free to reach out if you need any help.\n\nRegards,\nConNavi Team"
}
```
| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | string | ✅ | Target user's MongoDB `_id` |
| `subject` | string | ✅ | Email subject line |
| `message` | string | ✅ | Email body text (plain text; newlines preserved) |

**Response (200)**
```json
{
  "success": true,
  "message": "Email sent to john@example.com"
}
```

**Response — No email on file (400)**
```json
{
  "success": false,
  "message": "This user has no email address on record"
}
```

---

## Common Error Responses

| Status | Body | Reason |
|---|---|---|
| `401` | `{ "success": false, "message": "Not authorized - no token provided" }` | Missing Authorization header |
| `401` | `{ "success": false, "message": "Session expired - please login again" }` | JWT expired |
| `401` | `{ "success": false, "message": "Not authorized - invalid token" }` | Tampered or wrong token |
| `403` | `{ "success": false, "message": "Admin access required" }` | Valid token but role is not `admin` |
| `404` | `{ "success": false, "message": "User not found" }` | userId does not exist |
| `500` | `{ "success": false, "message": "Server error" }` | Unexpected server-side error |
