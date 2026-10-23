# MessTally API Documentation

MessTally is a shared-mess meal and expense tracker. This document covers every route that is actually mounted by `src/app.ts`, the JSON each one accepts, what it returns, the authorization it requires, and the errors it can produce.

- Base URL: `http://localhost:8000/api/v1`
- All request and response bodies are JSON unless a route says otherwise.
- Dates are date-only strings (`YYYY-MM-DD`). Months are `YYYY-MM`. All month boundaries are computed in UTC; "today" and the meal cutoff use `APP_TIMEZONE` (default `Asia/Dhaka`).
- Money values are JSON numbers with at most 2 decimal places.

> The source of truth for this document is the route, validation, and service code. It intentionally differs from older notes where they are stale (for example, meal writes require a manager).

---

## Contents

1. [Response format](#response-format)
2. [Authentication](#authentication)
3. [Authorization model](#authorization-model)
4. [Plan gates (FREE vs PRO)](#plan-gates-free-vs-pro)
5. [Common errors](#common-errors)
6. [Endpoint index](#endpoint-index)
7. [Auth](#auth)
8. [Mess](#mess)
9. [Members](#members)
10. [Months](#months)
11. [Meals](#meals)
12. [Bazar](#bazar)
13. [Utilities](#utilities)
14. [Utility fund deposits](#utility-fund-deposits)
15. [Summary](#summary)
16. [Dashboard](#dashboard)
17. [Profile](#profile)
18. [Subscription](#subscription)
19. [Global error reference](#global-error-reference)

---

## Response format

Every JSON success response uses the same envelope (`sendResponse`):

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Human readable message",
  "data": {}
}
```

`meta` is reserved for paginated responses and is omitted by every route today.

Every JSON error response uses the global error handler:

```json
{
  "success": false,
  "statusCode": 403,
  "name": "Forbidden",
  "message": "Manager access is required for this action.",
  "error": { "...": "development only" },
  "stack": "development only"
}
```

> **Important:** outside development (`NODE_ENV !== "development"`) the handler replaces `message` with `"Internal Server Error"` and `name` with `"Internal Server Error"`, and omits `error`/`stack`. The error tables below list the **development** message, which is the only one you can act on. Clients must branch on `statusCode`, not on `message`.

Success status codes used: `200`, `201`, `302` (bKash callback), `200` with `text/csv` or `application/pdf` bodies (exports/statements).

Unknown routes return a different shape (no `success` field):

```json
{
  "message": "Route not found",
  "path": "/api/v1/nope",
  "date": "2026-10-23T10:00:00.000Z"
}
```

---

## Authentication

Two equivalent transports are accepted by `auth(...)`:

```http
Authorization: Bearer <accessToken>
```

or the httpOnly cookie set by `POST /auth/login` / `POST /auth/verify-email`:

```
accessToken=<jwt>
```

CORS is credentialed and restricted to `FRONTEND_URL`, so browser clients must send credentials.

Rules enforced on every protected route:

1. The access token must verify with `JWT_ACCESS_SECRET`.
2. The payload must contain `userId`, `email`, `name`, `role`.
3. A user row must still exist with exactly that `id`, `email`, `name`, and `role`.
4. The user must be `ACTIVE` and not deleted.

The JWT is **identity-only**. It never contains a mess id. Mess scope always comes from `user.activeMessId` in the database, verified against the `mess_member` row.

Tokens: access token 24 hours, refresh token 7 days. `POST /auth/refresh-token` reads only the `refreshToken` cookie.

---

## Authorization model

Two independent layers apply.

### Layer 1 — system role

`Role` is `USER | ADMIN | SUPERADMIN`. Every protected route in this API accepts all three, so this layer only proves "a valid, active account". There is no admin bypass for mess-level rules: a `SUPERADMIN` who is not a member of a mess cannot read its data.

### Layer 2 — mess role and plan

Mess-scoped routes resolve the caller's membership with `requireActiveMembership`:

- `user.activeMessId` must be set.
- The matching `mess_member` row must exist and be `ACTIVE`.
- Otherwise the request fails with `403`.

Within a mess:

| Level | How it is determined | Used for |
|---|---|---|
| **Any active member** | `membership.status = ACTIVE` | Reads, bazar writes, utility bill writes, own meal edits |
| **Manager** | `membership.is_manager = true` | Meal grid writes, member approvals, deposits, month open/close, subscription |
| **Owner** | `membership.role = OWNER` | Ownership transfer only |
| **Manager or owner** | `is_manager` OR `role = OWNER` | Manager transfer (owner escape hatch) |
| **No active mess** | required for `POST /mess` and `POST /mess/join` | One active mess per user |

Notes:

- A mess has one `OWNER` row and at most one manager (`is_manager`). Creating a mess makes you `OWNER` + manager.
- A manager can give up the flag with `PATCH /mess/members/:id/manager`; the owner can still call that route even without the flag.
- Cross-mess ids are always `404`, never `403`, so ids from another mess are not confirmed to exist.
- `FREE` messes are capped at **5 active members**. PRO is uncapped.

### Access key used in this document

- `Public` — no token.
- `Auth` — any authenticated user; no active mess required.
- `Active member` — `Auth` + valid `ACTIVE` membership.
- `Manager` — `Active member` + `is_manager = true`.
- `Owner` — `Active member` + `role = OWNER`.
- `Manager or owner` — either of the two.
- `+ PRO` — active PRO subscription required (`plan = PRO` and `planExpiresAt` in the future).

---

## Plan gates (FREE vs PRO)

A mess is PRO only while `plan = PRO` **and** `planExpiresAt > now`. There is no grace period.

| Capability | FREE | PRO |
|---|---|---|
| Active members | up to 5 | unlimited |
| Bazar receipt image upload/delete | `402` | allowed |
| Self-service meals (`PATCH /meals/me`) | `402` | allowed |
| Past-month reads (meals, bazar, utilities, deposits, summary, dashboard, export) | `402` | allowed |
| PDF member statement | `402` | allowed, closed months only |
| Create/edit data in a past open month | allowed | allowed |

Past-month gate message:

```json
{
  "success": false,
  "statusCode": 402,
  "name": "Payment Required",
  "message": "Past month archives require an active PRO subscription."
}
```

The "current month" comparison uses `APP_TIMEZONE`, while all stored month ranges are UTC.

---

## Common errors

These can occur on almost any protected route and are not repeated in every table.

| Status | Development message | Cause |
|---|---|---|
| `401` | `You are not logged in. Please log in to access this resource.` | No token in header or cookie |
| `401` | `Invalid or expired token. Please log in again.` | Bad signature, malformed token, expired access token |
| `401` | `Invalid token payload. Please log in again.` | Token missing `userId`/`email`/`name`/`role` |
| `401` | `User not found. Please log in again.` | User row deleted or role/name/email changed after issue |
| `401` | `User is inactive or not found. Please log in again.` | Account not `ACTIVE` or soft-deleted |
| `401` | `Your session has expired. Please log in again.` | jwt `TokenExpiredError` from refresh/verify |
| `403` | `Forbidden. You don't have permission to access this resource.` | JWT role not in the route's allowed roles (currently never for USER/ADMIN/SUPERADMIN) |
| `403` | `You are not an active member of any mess.` | No `activeMessId`, or no ACTIVE membership |
| `403` | `Your active mess is no longer valid. Please select a mess again.` | Stale `activeMessId` pointer |
| `500` | varies | Unhandled error; production always shows `Internal Server Error` |
| `503` | `The database is temporarily unavailable. Please try again in a moment.` | Transient Postgres/Prisma connection failure |

Duplicate-key and FK failures are mapped to `400` with `Duplicate Key Error` / `Foreign key constraint failed`.

---

## Endpoint index

| # | Method | Path | Access | Module |
|---|---|---|---|---|
| 1 | POST | `/auth/register` | Public | Auth |
| 2 | POST | `/auth/verify-email` | Public | Auth |
| 3 | POST | `/auth/login` | Public | Auth |
| 4 | POST | `/auth/resend-otp` | Public | Auth |
| 5 | POST | `/auth/forgot-password` | Public | Auth |
| 6 | POST | `/auth/reset-password` | Public | Auth |
| 7 | GET | `/auth/me` | Auth | Auth |
| 8 | POST | `/auth/refresh-token` | Public (refresh cookie) | Auth |
| 9 | POST | `/mess` | Auth, no active mess | Mess |
| 10 | GET | `/mess/my` | Auth | Mess |
| 11 | POST | `/mess/join` | Auth, no active mess | Mess |
| 12 | GET | `/mess/members` | Active member | Members |
| 13 | GET | `/mess/members/pending` | Manager | Members |
| 14 | PATCH | `/mess/members/:id/approve` | Manager | Members |
| 15 | PATCH | `/mess/members/:id/reject` | Manager | Members |
| 16 | PATCH | `/mess/members/:id/manager` | Manager or owner | Members |
| 17 | PATCH | `/mess/members/:id/owner` | Owner | Members |
| 18 | DELETE | `/mess/members/:id` | Manager | Members |
| 19 | POST | `/mess/leave` | Active member | Members |
| 20 | GET | `/months` | Active member | Months |
| 21 | POST | `/months` | Manager | Months |
| 22 | PATCH | `/months/:id/close` | Manager (+ PRO for past) | Months |
| 23 | PATCH | `/months/:id/reopen` | Manager (+ PRO for past) | Months |
| 24 | GET | `/meals` | Active member (+ PRO for past) | Meals |
| 25 | PUT | `/meals` | Manager | Meals |
| 26 | PATCH | `/meals/me` | Active member + PRO | Meals |
| 27 | POST | `/meals/bulk` | Manager | Meals |
| 28 | DELETE | `/meals/:id` | Manager | Meals |
| 29 | GET | `/bazar` | Active member (+ PRO for past) | Bazar |
| 30 | POST | `/bazar` | Active member | Bazar |
| 31 | PATCH | `/bazar/:id` | Active member | Bazar |
| 32 | DELETE | `/bazar/:id` | Active member | Bazar |
| 33 | POST | `/bazar/:id/receipt` | Active member + PRO | Bazar |
| 34 | DELETE | `/bazar/:id/receipt` | Active member + PRO | Bazar |
| 35 | GET | `/utilities` | Active member (+ PRO for past) | Utilities |
| 36 | POST | `/utilities` | Active member | Utilities |
| 37 | PATCH | `/utilities/:id` | Active member | Utilities |
| 38 | PATCH | `/utilities/:id/paid` | Active member | Utilities |
| 39 | DELETE | `/utilities/:id` | Active member | Utilities |
| 40 | GET | `/utilities/fund` | Active member (+ PRO for past) | Utilities |
| 41 | GET | `/utilities/replenishment-estimate` | Manager | Utilities |
| 42 | GET | `/utilities/fund-deposits` | Active member (+ PRO for past) | Deposits |
| 43 | POST | `/utilities/fund-deposits` | Manager | Deposits |
| 44 | PATCH | `/utilities/fund-deposits/:id` | Manager | Deposits |
| 45 | DELETE | `/utilities/fund-deposits/:id` | Manager | Deposits |
| 46 | GET | `/summary` | Active member (+ PRO for past) | Summary |
| 47 | GET | `/summary/export` | Active member (+ PRO for past) | Summary |
| 48 | GET | `/summary/statement` | Active member + PRO | Summary |
| 49 | GET | `/dashboard` | Active member (+ PRO for past) | Dashboard |
| 50 | PATCH | `/profile/image` | Auth | Profile |
| 51 | PATCH | `/profile/update` | Auth | Profile |
| 52 | GET | `/subscription/callback` | Public (bKash redirect) | Subscription |
| 53 | GET | `/subscription` | Active member | Subscription |
| 54 | POST | `/subscription/activate` | Manager | Subscription |
| 55 | GET | `/subscription/payments` | Active member | Subscription |
| 56 | GET | `/subscription/payments/:id/status` | Active member | Subscription |

---

## Auth

### 1. `POST /auth/register`

**Access:** Public.

Creates a pending registration in Redis (password hashed, OTP valid 5 minutes) and emails a 6-digit code. **No user row exists until `verify-email` succeeds.** The email domain is checked against DNS MX records.

```json
{
  "name": "Masad Rahman",
  "email": "masad@example.com",
  "password": "mess1234"
}
```

Validation: `name` 2–80 characters, letters/spaces/dot/apostrophe/hyphen only; `email` ≤ 254 chars; `password` 8+ chars, ≤ 72 bytes, at least one letter and one digit.

Success `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Verification code sent to your email",
  "data": {
    "email": "masad@example.com",
    "purpose": "REGISTRATION",
    "expiresInSeconds": 300,
    "resendAvailableInSeconds": 60,
    "resendsRemaining": 3
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Name is required` / `Name must be at least 2 characters` / `Enter a valid email address, e.g. name@example.com` / `Password must be at least 8 characters` | Validation (first issue only) |
| `400` | `This email domain cannot receive emails. Please check for a typo, e.g. name@gmail.com` | Domain has a null MX record |
| `400` | `This email domain does not exist. Please check for a typo, e.g. name@gmail.com` | NXDOMAIN |
| `409` | `User with this email already exists` | Email already registered |
| `429` | `Please wait N second(s) before requesting another code` | 60-second cooldown |
| `500` | mail/Redis error | SMTP or Redis failure; Redis keys are rolled back |

Error example:

```json
{
  "success": false,
  "statusCode": 409,
  "name": "Conflict",
  "message": "User with this email already exists"
}
```

---

### 2. `POST /auth/verify-email`

**Access:** Public. Consumes the registration OTP, creates the user, logs them in (sets both cookies), and emails a welcome message.

```json
{
  "email": "masad@example.com",
  "otp": "123456"
}
```

Success `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Email verified successfully",
  "data": {
    "user": {
      "id": "7c1e0f9a-0000-4a00-9000-000000000001",
      "name": "Masad Rahman",
      "email": "masad@example.com",
      "role": "USER",
      "status": "ACTIVE",
      "emailVerified": true,
      "activeMessId": null,
      "isDeleted": false,
      "createdAt": "2026-10-23T10:00:00.000Z",
      "updatedAt": "2026-10-23T10:00:00.000Z",
      "profile": {
        "id": "b2b0b8f0-0000-4000-8000-000000000002",
        "userId": "7c1e0f9a-0000-4a00-9000-000000000001",
        "imageUrl": null,
        "imagePublicId": null,
        "bio": null,
        "phone": null,
        "address": null,
        "createdAt": "2026-10-23T10:00:00.000Z",
        "updatedAt": "2026-10-23T10:00:00.000Z"
      }
    },
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi..."
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Verification code must be exactly 6 digits` | `otp` is not a 6-digit string |
| `400` | `No pending registration found for this email. Please register again.` | Registration data expired/missing |
| `400` | `Verification code has expired. Please request a new one.` | OTP expired |
| `400` | `Incorrect verification code. N attempt(s) left.` | Wrong OTP (max 5) |
| `403` | `User is Suspended` / `User is Deleted` | Existing account state |
| `409` | `Email ALready Verified` | Account exists and is verified |
| `429` | `Too many incorrect attempts. Please request a new verification code.` | 5th wrong OTP |

---

### 3. `POST /auth/login`

**Access:** Public. Sets `accessToken` (24 h) and `refreshToken` (7 d) cookies and returns the same tokens.

```json
{
  "email": "masad@example.com",
  "password": "mess1234"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "User logged in successfully",
  "data": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi...",
    "activeMessId": "1f2e3d4c-0000-4000-8000-000000000003",
    "mess": {
      "id": "1f2e3d4c-0000-4000-8000-000000000003",
      "name": "Sunrise Mess",
      "roomCode": "SUN-K7P9M2X4",
      "currency": "BDT",
      "isJoinable": true,
      "requireApproval": true,
      "mealCutoffTime": "11:00"
    }
  }
}
```

`mess` is `null` when the user has no active mess.

| Status | Development message | Cause |
|---|---|---|
| `400` | `Enter a valid email address, e.g. name@example.com` / `Password is required` | Validation |
| `401` | `Invalid credentials` | Wrong password |
| `403` | `User is Suspended` / `User is deleted` | Account state |
| `404` | `User Not Found` | No account for that email |

---

### 4. `POST /auth/resend-otp`

**Access:** Public. One endpoint for both flows; `purpose` decides which Redis session must exist.

```json
{
  "email": "masad@example.com",
  "purpose": "REGISTRATION"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "A new verification code has been sent to your email",
  "data": {
    "email": "masad@example.com",
    "purpose": "REGISTRATION",
    "expiresInSeconds": 300,
    "resendAvailableInSeconds": 60,
    "resendsRemaining": 2
  }
}
```

Limits: 60-second cooldown, maximum 3 resends per session, OTP session extended to 1 hour.

| Status | Development message | Cause |
|---|---|---|
| `400` | `Purpose must be either REGISTRATION or FORGOT_PASSWORD` | Invalid purpose |
| `400` | `No pending registration found for this email. Please register first.` | `purpose=REGISTRATION` with no session |
| `400` | `No pending password reset found for this email. Please request a password reset first.` | `purpose=FORGOT_PASSWORD` with no session |
| `403` | `User is suspended` / `User is deleted` / `Email is not verified` | Forgot-password account checks |
| `404` | `User not found` | Forgotten-password account disappeared |
| `409` | `This email is already registered. Please log in.` | Registration completed in the meantime |
| `429` | `Please wait N second(s) before requesting another code` | Cooldown |
| `429` | `Resend limit reached for this session. Please start the process again.` | 3 resends used |

---

### 5. `POST /auth/forgot-password`

**Access:** Public. Emails a reset code valid 5 minutes.

```json
{
  "email": "masad@example.com"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Password reset code sent to your email",
  "data": {
    "email": "masad@example.com",
    "purpose": "FORGOT_PASSWORD",
    "expiresInSeconds": 300,
    "resendAvailableInSeconds": 60,
    "resendsRemaining": 3
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Enter a valid email address, e.g. name@example.com` | Validation |
| `403` | `User is suspended` / `User is deleted` / `Email is not verified` | Account state |
| `404` | `User not found` | No account |
| `429` | `Please wait N second(s) before requesting another code` | Cooldown |

---

### 6. `POST /auth/reset-password`

**Access:** Public. Verifies the emailed OTP and replaces the password, then emails a confirmation.

```json
{
  "email": "masad@example.com",
  "newPassword": "newPass123",
  "otp": "654321"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Password reset successfully",
  "data": null
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Password must contain at least one letter and one number` / `Verification code must be exactly 6 digits` | Validation |
| `400` | `Password reset code has expired. Please request a new one.` | OTP missing |
| `400` | `Incorrect password reset code. N attempt(s) left.` | Wrong OTP |
| `403` | `User is suspended` / `User is deleted` / `Email is not verified` | Account state |
| `404` | `User not found` | No account |
| `429` | `Too many incorrect attempts. Please request a new password reset code.` | 5th wrong OTP |

---

### 7. `GET /auth/me`

**Access:** Auth. Returns the caller's user row with `profile`; password is omitted.

Request (no body):

```json
{
  "method": "GET",
  "path": "/api/v1/auth/me"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "User profile fetched successfully",
  "data": {
    "id": "7c1e0f9a-0000-4a00-9000-000000000001",
    "name": "Masad Rahman",
    "email": "masad@example.com",
    "role": "USER",
    "status": "ACTIVE",
    "emailVerified": true,
    "activeMessId": "1f2e3d4c-0000-4000-8000-000000000003",
    "isDeleted": false,
    "createdAt": "2026-10-23T10:00:00.000Z",
    "updatedAt": "2026-10-23T10:00:00.000Z",
    "profile": {
      "id": "b2b0b8f0-0000-4000-8000-000000000002",
      "userId": "7c1e0f9a-0000-4000-9000-000000000001",
      "imageUrl": "https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg",
      "imagePublicId": "mess-tally/avatars/abc",
      "bio": "Backend developer",
      "phone": "+8801700000000",
      "address": "Dhaka",
      "createdAt": "2026-10-23T10:00:00.000Z",
      "updatedAt": "2026-10-23T10:00:00.000Z"
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `401` | `User information is missing in the request` | `req.user` not attached |
| `404` | `User not found` | Row deleted between auth and lookup |

---

### 8. `POST /auth/refresh-token`

**Access:** Public, but requires the `refreshToken` httpOnly cookie. Rotates both tokens.

Request (no body; cookie is the input):

```json
{
  "cookies": {
    "refreshToken": "eyJhbGciOi..."
  }
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "New tokens generated successfully",
  "data": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi...",
    "activeMessId": "1f2e3d4c-0000-4000-8000-000000000003",
    "mess": {
      "id": "1f2e3d4c-0000-4000-8000-000000000003",
      "name": "Sunrise Mess",
      "roomCode": "SUN-K7P9M2X4",
      "currency": "BDT",
      "isJoinable": true,
      "requireApproval": true,
      "mealCutoffTime": "11:00"
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `401` | `Refresh token is missing` | No cookie |
| `401` | `Invalid refresh token` (prod) / jwt error text (dev) | Bad signature or expired |
| `401` | `User is inactive or not found` | Deleted or non-ACTIVE user |

## Mess

### 9. `POST /mess`

**Access:** Auth, and the caller must **not** have any `ACTIVE` membership. The creator becomes `OWNER` + manager and `user.activeMessId` is set to the new mess.

There is no Zod schema on this route; only `name` is required and trimmed. Unknown fields are ignored.

```json
{
  "name": "Sunrise Mess",
  "address": "House 12, Road 4, Dhaka",
  "currency": "BDT",
  "mealCutoffTime": "11:00",
  "isJoinable": true,
  "requireApproval": true
}
```

Defaults: `address = null`, `currency = "BDT"` (uppercased), `mealCutoffTime = "11:00"`, `isJoinable = true`, `requireApproval = true`. A room code is generated as `<3-letter-prefix>-<8 chars>` (e.g. `SUN-K7P9M2X4`).

Success `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Mess created successfully",
  "data": {
    "mess": {
      "id": "1f2e3d4c-0000-4000-8000-000000000003",
      "name": "Sunrise Mess",
      "address": "House 12, Road 4, Dhaka",
      "currency": "BDT",
      "roomCode": "SUN-K7P9M2X4",
      "isJoinable": true,
      "requireApproval": true,
      "mealCutoffTime": "11:00",
      "plan": "FREE",
      "planExpiresAt": null,
      "createdAt": "2026-10-23T10:00:00.000Z",
      "updatedAt": "2026-10-23T10:00:00.000Z",
      "members": [
        {
          "id": "0a1b2c3d-0000-4000-8000-000000000004",
          "userId": "7c1e0f9a-0000-4a00-9000-000000000001",
          "messId": "1f2e3d4c-0000-4000-8000-000000000003",
          "role": "OWNER",
          "status": "ACTIVE",
          "isManager": true,
          "rentShare": 1,
          "fixedRentAmount": null,
          "joinedAt": "2026-10-23T10:00:00.000Z",
          "leftAt": null
        }
      ]
    },
    "activeMessId": "1f2e3d4c-0000-4000-8000-000000000003"
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Mess name is required` | Missing/blank `name` |
| `403` | `User is not active` | Account not `ACTIVE` |
| `404` | `User not found` | User row missing/deleted |
| `409` | `You are already an active member of "Other Mess". Leave that mess before creating a new one.` | One active mess per user |

---

### 10. `GET /mess/my`

**Access:** Auth. Returns every membership except `REJECTED`, with the active one flagged. A stale `activeMessId` is reported as `null`.

```json
{
  "method": "GET",
  "path": "/api/v1/mess/my"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Messes fetched successfully",
  "data": {
    "activeMessId": "1f2e3d4c-0000-4000-8000-000000000003",
    "messes": [
      {
        "membershipId": "0a1b2c3d-0000-4000-8000-000000000004",
        "role": "OWNER",
        "status": "ACTIVE",
        "isManager": true,
        "joinedAt": "2026-10-23T10:00:00.000Z",
        "leftAt": null,
        "isActive": true,
        "mess": {
          "id": "1f2e3d4c-0000-4000-8000-000000000003",
          "name": "Sunrise Mess",
          "address": "House 12, Road 4, Dhaka",
          "currency": "BDT",
          "roomCode": "SUN-K7P9M2X4",
          "isJoinable": true,
          "requireApproval": true,
          "mealCutoffTime": "11:00"
        }
      }
    ]
  }
}
```

Ordering: `ACTIVE`, then `PENDING`, then `LEFT`; newest `joinedAt` first inside each group.

| Status | Development message | Cause |
|---|---|---|
| `401` | `User information is missing in the request` | Missing auth context |

---

### 11. `POST /mess/join`

**Access:** Auth, and no `ACTIVE` membership. If the mess has `requireApproval = false` the caller becomes `ACTIVE` immediately; otherwise the row is `PENDING` and a manager must approve it.

```json
{
  "roomCode": "SUN-K7P9M2X4"
}
```

`roomCode` is trimmed, uppercased, 1–64 characters. A `LEFT`/`REJECTED` membership row is reused.

Success `201` in both cases:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Join request sent. Waiting for approval",
  "data": {
    "mess": {
      "id": "1f2e3d4c-0000-4000-8000-000000000003",
      "name": "Sunrise Mess",
      "roomCode": "SUN-K7P9M2X4",
      "currency": "BDT",
      "isJoinable": true,
      "requireApproval": true,
      "mealCutoffTime": "11:00",
      "plan": "FREE",
      "planExpiresAt": null
    },
    "membership": {
      "id": "0a1b2c3d-0000-4000-8000-000000000005",
      "userId": "7c1e0f9a-0000-4a00-9000-000000000001",
      "messId": "1f2e3d4c-0000-4000-8000-000000000003",
      "role": "MEMBER",
      "status": "PENDING",
      "isManager": false,
      "rentShare": 1,
      "fixedRentAmount": null,
      "joinedAt": "2026-10-23T10:00:00.000Z",
      "leftAt": null
    },
    "activeMessId": null
  }
}
```

When `requireApproval = false`, the message is `Joined the mess successfully`, `status` is `ACTIVE`, and `activeMessId` is the mess id.

| Status | Development message | Cause |
|---|---|---|
| `400` | `Room code is required` / `Room code is too long` | Validation |
| `403` | `This mess is not accepting new members` | `isJoinable = false` |
| `404` | `No mess found with this room code` | Unknown/incorrect code |
| `409` | `You are already an active member of this mess` | Already in this mess |
| `409` | `You are already an active member of "Other Mess". Leave it before joining another mess` | One active mess per user |
| `409` | `Your join request for this mess is already pending approval` | Duplicate pending request |
| `409` | `You are already a member of this mess` | Membership is `ACTIVE` |
| `409` | `The FREE plan allows up to 5 active members. Upgrade to PRO for unlimited members.` | Auto-join into a full FREE mess |

---

## Members

All member responses use the same row shape:

```json
{
  "id": "0a1b2c3d-0000-4000-8000-000000000005",
  "userId": "7c1e0f9a-0000-4a00-9000-000000000001",
  "name": "Masad Rahman",
  "email": "masad@example.com",
  "avatarUrl": null,
  "role": "MEMBER",
  "status": "ACTIVE",
  "isManager": false,
  "rentShare": 1,
  "fixedRentAmount": null,
  "joinedAt": "2026-10-23T10:00:00.000Z",
  "leftAt": null
}
```

### 12. `GET /mess/members`

**Access:** Active member. Lists memberships in the caller's mess, active first.

```json
{
  "method": "GET",
  "path": "/api/v1/mess/members",
  "query": {
    "status": "ACTIVE"
  }
}
```

`status` is optional: `PENDING | ACTIVE | LEFT | REJECTED`. It is parsed manually by the controller.

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Members fetched successfully",
  "data": {
    "members": [
      {
        "id": "0a1b2c3d-0000-4000-8000-000000000005",
        "userId": "7c1e0f9a-0000-4a00-9000-000000000001",
        "name": "Masad Rahman",
        "email": "masad@example.com",
        "avatarUrl": null,
        "role": "MEMBER",
        "status": "ACTIVE",
        "isManager": false,
        "rentShare": 1,
        "fixedRentAmount": null,
        "joinedAt": "2026-10-23T10:00:00.000Z",
        "leftAt": null
      }
    ],
    "total": 1
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Invalid member status` | Bad `?status=` value |
| `403` | `You are not an active member of any mess.` | No active mess |

---

### 13. `GET /mess/members/pending`

**Access:** Manager. Returns only `PENDING` join requests, oldest first.

```json
{
  "method": "GET",
  "path": "/api/v1/mess/members/pending"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Pending join requests fetched successfully",
  "data": {
    "members": [
      {
        "id": "0a1b2c3d-0000-4000-8000-000000000006",
        "userId": "9d8c7b6a-0000-4000-8000-000000000007",
        "name": "Rahim Uddin",
        "email": "rahim@example.com",
        "avatarUrl": null,
        "role": "MEMBER",
        "status": "PENDING",
        "isManager": false,
        "rentShare": 1,
        "fixedRentAmount": null,
        "joinedAt": "2026-10-23T11:00:00.000Z",
        "leftAt": null
      }
    ],
    "total": 1
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `403` | `Manager access is required for this action.` | Caller is not a manager |

---

### 14. `PATCH /mess/members/:id/approve`

**Access:** Manager. Approves a `PENDING` request, makes it `ACTIVE`, and points the user's `activeMessId` here.

```json
{
  "memberId": "0a1b2c3d-0000-4000-8000-000000000006"
}
```

The id goes in the path (the JSON above shows the value used); there is no request body.

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Join request approved successfully",
  "data": {
    "id": "0a1b2c3d-0000-4000-8000-000000000006",
    "userId": "9d8c7b6a-0000-4000-8000-000000000007",
    "name": "Rahim Uddin",
    "email": "rahim@example.com",
    "avatarUrl": null,
    "role": "MEMBER",
    "status": "ACTIVE",
    "isManager": false,
    "rentShare": 1,
    "fixedRentAmount": null,
    "joinedAt": "2026-10-23T11:30:00.000Z",
    "leftAt": null
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `403` | `Manager access is required for this action.` | Not a manager |
| `404` | `No member found with this id in your mess` | Unknown or cross-mess id |
| `409` | `Only pending join requests can be approved. This member is already ACTIVE.` | Status is not `PENDING` |
| `409` | `This user is already an active member of "Other Mess". They must leave that mess before they can be approved here.` | One active mess per user |
| `409` | `The FREE plan allows up to 5 active members. Upgrade to PRO for unlimited members.` | FREE capacity reached |

---

### 15. `PATCH /mess/members/:id/reject`

**Access:** Manager. Sets the request to `REJECTED` and clears a stale active pointer. The row is kept so the user can request again later.

```json
{
  "memberId": "0a1b2c3d-0000-4000-8000-000000000006"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Join request rejected successfully",
  "data": {
    "id": "0a1b2c3d-0000-4000-8000-000000000006",
    "userId": "9d8c7b6a-0000-4000-8000-000000000007",
    "name": "Rahim Uddin",
    "email": "rahim@example.com",
    "avatarUrl": null,
    "role": "MEMBER",
    "status": "REJECTED",
    "isManager": false,
    "rentShare": 1,
    "fixedRentAmount": null,
    "joinedAt": "2026-10-23T11:00:00.000Z",
    "leftAt": null
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `403` | `Manager access is required for this action.` | Not a manager |
| `404` | `No member found with this id in your mess` | Unknown/cross-mess id |
| `409` | `Only pending join requests can be rejected. This member is already ACTIVE.` | Status is not `PENDING` |

---

### 16. `PATCH /mess/members/:id/manager`

**Access:** Manager or owner. Moves the single manager flag to an `ACTIVE` member. If the caller is the owner, they stay `OWNER` and only lose `isManager`.

```json
{
  "memberId": "0a1b2c3d-0000-4000-8000-000000000005"
}
```

Success `200` (the promoted member):

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Manager position transferred successfully",
  "data": {
    "id": "0a1b2c3d-0000-4000-8000-000000000005",
    "userId": "7c1e0f9a-0000-4a00-9000-000000000001",
    "name": "Masad Rahman",
    "email": "masad@example.com",
    "avatarUrl": null,
    "role": "MEMBER",
    "status": "ACTIVE",
    "isManager": true,
    "rentShare": 1,
    "fixedRentAmount": null,
    "joinedAt": "2026-10-23T10:00:00.000Z",
    "leftAt": null
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Choose another member: you cannot transfer the manager position to yourself.` | Target is the caller |
| `403` | `Manager access is required for this action.` | Caller is neither manager nor owner |
| `404` | `No member found with this id in your mess` | Unknown/cross-mess id |
| `409` | `Only active members can hold the manager position.` | Target not `ACTIVE` |

---

### 17. `PATCH /mess/members/:id/owner`

**Access:** Owner. Transfers `OWNER` to another `ACTIVE` member. The old owner becomes `MEMBER` and loses the manager flag; the new owner becomes manager.

```json
{
  "memberId": "0a1b2c3d-0000-4000-8000-000000000005"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Ownership transferred successfully",
  "data": {
    "id": "0a1b2c3d-0000-4000-8000-000000000005",
    "userId": "7c1e0f9a-0000-4a00-9000-000000000001",
    "name": "Masad Rahman",
    "email": "masad@example.com",
    "avatarUrl": null,
    "role": "OWNER",
    "status": "ACTIVE",
    "isManager": true,
    "rentShare": 1,
    "fixedRentAmount": null,
    "joinedAt": "2026-10-23T10:00:00.000Z",
    "leftAt": null
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `You already own this mess.` | Target is the caller |
| `403` | `Only the mess owner can perform this action.` | Caller is not `OWNER` |
| `404` | `No member found with this id in your mess` | Unknown/cross-mess id |
| `409` | `Ownership can only be transferred to an active member.` | Target not `ACTIVE` |

---

### 18. `DELETE /mess/members/:id`

**Access:** Manager. Hard-deletes a membership **only** when nothing references it. Otherwise the caller must set the member to `LEFT` (not exposed as a route yet).

```json
{
  "memberId": "0a1b2c3d-0000-4000-8000-000000000006"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Member removed successfully",
  "data": {
    "id": "0a1b2c3d-0000-4000-8000-000000000006",
    "deleted": true
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `You cannot remove yourself. Use POST /api/mess/leave to leave the mess.` | Target is the caller |
| `403` | `Manager access is required for this action.` | Not a manager |
| `403` | `The mess owner cannot be removed from the mess.` | Target is `OWNER` |
| `404` | `No member found with this id in your mess` | Unknown/cross-mess id |
| `409` | `This member has existing records (3 meal entries, 2 bazar entries, 1 deposit, 1 utility bill, 1 payment). Set the membership status to LEFT instead of deleting it.` | Referenced by meal/bazar/deposit/utility/payment rows |

---

### 19. `POST /mess/leave`

**Access:** Active member. Sets the membership to `LEFT`, clears `activeMessId`, and gives up `isManager`. An owner can leave only when no other member is active.

```json
{
  "confirm": true
}
```

No body field is read; the JSON above documents the caller's intent.

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "You have left the mess successfully",
  "data": {
    "messId": "1f2e3d4c-0000-4000-8000-000000000003",
    "leftAt": "2026-10-23T12:00:00.000Z",
    "activeMessId": null
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `403` | `You are not an active member of any mess.` | No active membership |
| `409` | `You are the owner of "Sunrise Mess". Transfer ownership to another active member before leaving the mess.` | Owner with other active members |

---

## Months

Month objects (`IMonthSummary`):

```json
{
  "id": "4f5e6d7c-0000-4000-8000-000000000010",
  "name": "2026-10",
  "startDate": "2026-10-01",
  "endDate": "2026-10-31",
  "status": "ACTIVE",
  "managerId": "0a1b2c3d-0000-4000-8000-000000000004",
  "closedAt": null,
  "isCurrent": true
}
```

`status` is `ACTIVE | CLOSED`. A month row is auto-created by the first write in that month; reads never create one.

### 20. `GET /months`

**Access:** Active member. Newest first. A FREE mess only sees the current month; PRO sees all rows.

```json
{
  "method": "GET",
  "path": "/api/v1/months"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Months fetched successfully",
  "data": {
    "months": [
      {
        "id": "4f5e6d7c-0000-4000-8000-000000000010",
        "name": "2026-10",
        "startDate": "2026-10-01",
        "endDate": "2026-10-31",
        "status": "ACTIVE",
        "managerId": "0a1b2c3d-0000-4000-8000-000000000004",
        "closedAt": null,
        "isCurrent": true
      }
    ],
    "total": 1
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `403` | `You are not an active member of any mess.` | No active membership |

---

### 21. `POST /months`

**Access:** Manager. Explicitly opens a month. Opening an already `ACTIVE` month is idempotent (`created: false`); a `CLOSED` month is a conflict.

```json
{
  "month": "2026-10"
}
```

Success `201` when created:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Month opened successfully",
  "data": {
    "month": {
      "id": "4f5e6d7c-0000-4000-8000-000000000010",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "ACTIVE",
      "managerId": "0a1b2c3d-0000-4000-8000-000000000004",
      "closedAt": null,
      "isCurrent": true
    },
    "created": true
  }
}
```

Already open: `200`, message `This month is already open`, `created: false`.

| Status | Development message | Cause |
|---|---|---|
| `400` | `Month must be in YYYY-MM format (for example 2026-10).` | Bad shape, month `00`/`13`, year outside 1970–2999 |
| `403` | `Manager access is required for this action.` | Not a manager |
| `409` | `This month (2026-09) is already closed. Reopen it before making changes.` | Target month is `CLOSED` |

---

### 22. `PATCH /months/:id/close`

**Access:** Manager. For a non-current month an active PRO plan is also required. Runs in one serializable transaction:

- computes and stores the meal summary + utility audit snapshot
- sets `status = CLOSED`, `closedAt`, `closedById`
- writes `lockedMealRate`, `lockedTotalMeals`, `lockedTotalBazar`, `lockedTotalUtilities`
- sets `isLocked = true` on every meal entry in the month

```json
{
  "monthId": "4f5e6d7c-0000-4000-8000-000000000010"
}
```

The id is a path parameter (shown as JSON for reference); there is no body.

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Month closed successfully",
  "data": {
    "month": {
      "id": "4f5e6d7c-0000-4000-8000-000000000010",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "CLOSED",
      "managerId": "0a1b2c3d-0000-4000-8000-000000000004",
      "closedAt": "2026-10-31T12:00:00.000Z",
      "isCurrent": true
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `402` | `Past month archives require an active PRO subscription.` | FREE mess closing a past month |
| `403` | `Manager access is required for this action.` | Not a manager |
| `404` | `No month found with this id in your mess` | Unknown/cross-mess id |
| `409` | `This month (2026-10) is already closed.` | Already `CLOSED` |
| `409` | `The month changed while finalizing it. Please retry.` | Serialization conflict after 2 attempts |

Closing is allowed even when `canSettle` is `false`; the settlement list is then empty and preserved in the snapshot.

---

### 23. `PATCH /months/:id/reopen`

**Access:** Manager (+ PRO for a past month). Clears the snapshot, `closedAt`, `closedById`, all `locked*` columns, sets `ACTIVE`, and unlocks every meal entry.

```json
{
  "monthId": "4f5e6d7c-0000-4000-8000-000000000010"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Month reopened successfully",
  "data": {
    "month": {
      "id": "4f5e6d7c-0000-4000-8000-000000000010",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "ACTIVE",
      "managerId": "0a1b2c3d-0000-4000-8000-000000000004",
      "closedAt": null,
      "isCurrent": true
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `402` | `Past month archives require an active PRO subscription.` | FREE mess reopening a past month |
| `403` | `Manager access is required for this action.` | Not a manager |
| `404` | `No month found with this id in your mess` | Unknown/cross-mess id |
| `409` | `This month (2026-10) is already active.` | Already `ACTIVE` |
| `409` | `The month changed while finalizing it. Please retry.` | Serialization conflict |

## Meals

Meal counts are non-negative finite numbers; fractions such as `0.5` are accepted. `guestMeals` is included in every cell total, member total, and house total.

A meal entry (`IMealEntryDto`):

```json
{
  "id": "aa11bb22-0000-4000-8000-000000000020",
  "messMonthId": "4f5e6d7c-0000-4000-8000-000000000010",
  "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
  "date": "2026-10-03",
  "breakfast": 1,
  "lunch": 2,
  "dinner": 1,
  "guestMeals": 0,
  "total": 4,
  "isLocked": false,
  "updatedById": "0a1b2c3d-0000-4000-8000-000000000004",
  "updatedAt": "2026-10-23T12:00:00.000Z"
}
```

### 24. `GET /meals`

**Access:** Active member (+ PRO when `month` is not the current month). Returns a dense grid: every day × every `ACTIVE` member. `LEFT` members appear only when they have entries in that month.

Reads never create a month row: a quiet month returns `200` with `month.id = null`, `month.exists = false`, and zero-filled cells.

```json
{
  "method": "GET",
  "path": "/api/v1/meals",
  "query": {
    "month": "2026-10"
  }
}
```

`month` is optional and defaults to the current month in `APP_TIMEZONE`.

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Meal grid fetched successfully",
  "data": {
    "month": {
      "id": "4f5e6d7c-0000-4000-8000-000000000010",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "ACTIVE",
      "exists": true
    },
    "days": ["2026-10-01", "2026-10-02", "2026-10-03"],
    "members": [
      {
        "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
        "name": "Masad Rahman",
        "avatarUrl": null,
        "status": "ACTIVE",
        "days": [
          {
            "date": "2026-10-01",
            "entryId": null,
            "breakfast": 0,
            "lunch": 0,
            "dinner": 0,
            "guestMeals": 0,
            "total": 0,
            "isLocked": false
          },
          {
            "date": "2026-10-02",
            "entryId": "aa11bb22-0000-4000-8000-000000000021",
            "breakfast": 1,
            "lunch": 2,
            "dinner": 1,
            "guestMeals": 0,
            "total": 4,
            "isLocked": false
          }
        ],
        "totals": {
          "breakfast": 1,
          "lunch": 2,
          "dinner": 1,
          "guestMeals": 0,
          "total": 4
        }
      }
    ],
    "houseTotals": {
      "breakfast": 1,
      "lunch": 2,
      "dinner": 1,
      "guestMeals": 0,
      "total": 4
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Month must be in YYYY-MM format (for example 2026-10).` | Bad `?month=` |
| `402` | `Past month archives require an active PRO subscription.` | FREE mess reading a past month |
| `403` | `You are not an active member of any mess.` | No active membership |

---

### 25. `PUT /meals`

**Access:** **Manager.** Replaces one whole cell, so all four counts are required. Upsert on `(month, member, date)`; idempotent.

```json
{
  "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
  "date": "2026-10-03",
  "breakfast": 1,
  "lunch": 2,
  "dinner": 1,
  "guestMeals": 0
}
```

The month is derived from `date`, auto-created if missing, and must not be `CLOSED`. `updatedById` is always the caller.

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Meal entry saved successfully",
  "data": {
    "entry": {
      "id": "aa11bb22-0000-4000-8000-000000000020",
      "messMonthId": "4f5e6d7c-0000-4000-8000-000000000010",
      "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
      "date": "2026-10-03",
      "breakfast": 1,
      "lunch": 2,
      "dinner": 1,
      "guestMeals": 0,
      "total": 4,
      "isLocked": false,
      "updatedById": "0a1b2c3d-0000-4000-8000-000000000004",
      "updatedAt": "2026-10-23T12:00:00.000Z"
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Invalid member id.` / `Date must be in YYYY-MM-DD format.` / `Meal counts cannot be negative.` / `Meal counts must be numbers.` | Validation |
| `403` | `Manager access is required for this action.` | Caller is not a manager |
| `404` | `No member found with this id in your mess` | Unknown/cross-mess member |
| `409` | `Only active members of your mess can be assigned meals.` | Member not `ACTIVE` |
| `409` | `This meal entry is locked and cannot be changed.` | Existing cell `isLocked` |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

> A FREE mess **can** write into a past month as long as it is not closed; only reads are PRO-gated.

---

### 26. `PATCH /meals/me`

**Access:** Active member + **PRO**. Self-service edit of the caller's own meal for **today only**, before `mealCutoffTime`. At least one count is required; omitted counts are left unchanged (or default to `0` when the row is created).

```json
{
  "date": "2026-10-23",
  "lunch": 2,
  "guestMeals": 1
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Your meal entry was saved successfully",
  "data": {
    "entry": {
      "id": "aa11bb22-0000-4000-8000-000000000022",
      "messMonthId": "4f5e6d7c-0000-4000-8000-000000000010",
      "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
      "date": "2026-10-23",
      "breakfast": 0,
      "lunch": 2,
      "dinner": 0,
      "guestMeals": 1,
      "total": 3,
      "isLocked": false,
      "updatedById": "0a1b2c3d-0000-4000-8000-000000000005",
      "updatedAt": "2026-10-23T12:00:00.000Z"
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Date must be in YYYY-MM-DD format.` / `At least one meal count is required.` | Validation |
| `400` | `Self-service meals are limited to today.` | `date` is not today in `APP_TIMEZONE` |
| `402` | `Self-service meals is a PRO feature. Ask your mess manager to activate PRO subscription.` | FREE mess |
| `403` | `You are not an active member of any mess.` | No active membership |
| `409` | `Today's meal cutoff has passed.` | Current time ≥ `mealCutoffTime` |
| `409` | `This meal entry is locked and cannot be changed.` | Locked cell |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

---

### 27. `POST /meals/bulk`

**Access:** **Manager.** One daily sheet for 1–200 members in a single transaction. Duplicate `memberId` values are rejected.

```json
{
  "date": "2026-10-03",
  "entries": [
    {
      "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
      "breakfast": 1,
      "lunch": 2,
      "dinner": 1,
      "guestMeals": 0
    },
    {
      "memberId": "0a1b2c3d-0000-4000-8000-000000000006",
      "breakfast": 0,
      "lunch": 1,
      "dinner": 1,
      "guestMeals": 2
    }
  ]
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Meal entries saved successfully",
  "data": {
    "entries": [
      {
        "id": "aa11bb22-0000-4000-8000-000000000020",
        "messMonthId": "4f5e6d7c-0000-4000-8000-000000000010",
        "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
        "date": "2026-10-03",
        "breakfast": 1,
        "lunch": 2,
        "dinner": 1,
        "guestMeals": 0,
        "total": 4,
        "isLocked": false,
        "updatedById": "0a1b2c3d-0000-4000-8000-000000000004",
        "updatedAt": "2026-10-23T12:00:00.000Z"
      }
    ]
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Add at least one member to the meal entry.` / `A bulk meal entry can contain at most 200 members.` / `Each member can appear only once in a bulk entry.` | Validation |
| `403` | `Manager access is required for this action.` | Not a manager |
| `404` | `One or more members do not belong to your mess` | Unknown/cross-mess member id |
| `409` | `Only active members of your mess can be assigned meals.` | Any member not `ACTIVE` |
| `409` | `One or more meal entries are locked and cannot be changed.` | Any existing locked cell |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

The whole batch is rejected if any entry fails.

---

### 28. `DELETE /meals/:id`

**Access:** **Manager.** Deletes one entry in the caller's mess.

```json
{
  "entryId": "aa11bb22-0000-4000-8000-000000000020"
}
```

The id is a path parameter (shown as JSON for reference); there is no body.

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Meal entry deleted successfully",
  "data": {
    "id": "aa11bb22-0000-4000-8000-000000000020",
    "deleted": true
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `403` | `Manager access is required for this action.` | Not a manager |
| `404` | `No meal entry found with this id in your mess` | Unknown/cross-mess id |
| `409` | `This meal entry is locked and cannot be changed.` | Locked entry |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

---

## Bazar

Any active member can read and write bazar entries. Utility data never mixes with bazar/meals.

A bazar entry:

```json
{
  "id": "bb22cc33-0000-4000-8000-000000000030",
  "title": "Weekly grocery",
  "items": "rice, chicken, oil",
  "amount": 2450.5,
  "bazarDate": "2026-10-23",
  "shopperId": "0a1b2c3d-0000-4000-8000-000000000005",
  "shopperName": "Masad Rahman",
  "addedById": "0a1b2c3d-0000-4000-8000-000000000004",
  "addedByName": "Manager",
  "paidFromMessFund": false,
  "receiptUrl": null,
  "createdAt": "2026-10-23T10:00:00.000Z",
  "updatedAt": "2026-10-23T10:00:00.000Z"
}
```

### 29. `GET /bazar`

**Access:** Active member (+ PRO for a past month). Chronological list for one month with per-shopper and house totals.

```json
{
  "method": "GET",
  "path": "/api/v1/bazar",
  "query": {
    "month": "2026-10",
    "shopperId": "0a1b2c3d-0000-4000-8000-000000000005",
    "from": "2026-10-01",
    "to": "2026-10-15"
  }
}
```

All four query fields are optional. `from`/`to` are inclusive and must stay inside the selected month. A missing month row returns `200` with `month.exists = false` and zero totals; GET never creates a month.

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Bazar entries fetched successfully",
  "data": {
    "month": {
      "id": "4f5e6d7c-0000-4000-8000-000000000010",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "ACTIVE",
      "exists": true
    },
    "entries": [
      {
        "id": "bb22cc33-0000-4000-8000-000000000030",
        "title": "Weekly grocery",
        "items": "rice, chicken, oil",
        "amount": 2450.5,
        "bazarDate": "2026-10-23",
        "shopperId": "0a1b2c3d-0000-4000-8000-000000000005",
        "shopperName": "Masad Rahman",
        "addedById": "0a1b2c3d-0000-4000-8000-000000000004",
        "addedByName": "Manager",
        "paidFromMessFund": false,
        "receiptUrl": null,
        "createdAt": "2026-10-23T10:00:00.000Z",
        "updatedAt": "2026-10-23T10:00:00.000Z"
      }
    ],
    "totals": {
      "houseTotal": 2450.5,
      "byShopper": [
        {
          "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
          "name": "Masad Rahman",
          "count": 1,
          "amount": 2450.5
        }
      ]
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Invalid member id.` / `Month must be in YYYY-MM format (for example 2026-10).` / `Date must be in YYYY-MM-DD format.` / `` `from` must be on or before `to`. `` | Query validation |
| `400` | `` `from` must be within the selected month. `` / `` `to` must be within the selected month. `` | Date filter escapes the month |
| `402` | `Past month archives require an active PRO subscription.` | FREE past-month read |
| `403` | `You are not an active member of any mess.` | No active membership |

---

### 30. `POST /bazar`

**Access:** Active member. Records a trip. `addedById` is the caller, `paidFromMessFund` is forced `false`, and the month is derived from `bazarDate` and auto-created.

```json
{
  "title": "Weekly grocery",
  "items": "rice, chicken, oil",
  "amount": 2450.5,
  "bazarDate": "2026-10-23",
  "shopperId": "0a1b2c3d-0000-4000-8000-000000000005"
}
```

`title` is optional (defaults to `"Bazar"`, max 120); `items` optional/nullable (max 1000); `amount` > 0, ≤ 99,999,999.99, max 2 decimals; `shopperId` must be an `ACTIVE` member of the caller's mess.

Success `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Bazar entry created successfully",
  "data": {
    "entry": {
      "id": "bb22cc33-0000-4000-8000-000000000030",
      "title": "Weekly grocery",
      "items": "rice, chicken, oil",
      "amount": 2450.5,
      "bazarDate": "2026-10-23",
      "shopperId": "0a1b2c3d-0000-4000-8000-000000000005",
      "shopperName": "Masad Rahman",
      "addedById": "0a1b2c3d-0000-4000-8000-000000000004",
      "addedByName": "Manager",
      "paidFromMessFund": false,
      "receiptUrl": null,
      "createdAt": "2026-10-23T10:00:00.000Z",
      "updatedAt": "2026-10-23T10:00:00.000Z"
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Invalid member id.` / `Date must be in YYYY-MM-DD format.` / `Amount must be greater than 0.` / `Amount can have at most 2 decimal places.` / `Amount is too large.` | Validation |
| `403` | `You are not an active member of any mess.` | No active membership |
| `404` | `No member found with this id in your mess` | Unknown/cross-mess shopper |
| `409` | `Only active members of your mess can be selected as the shopper.` | Shopper not `ACTIVE` |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

---

### 31. `PATCH /bazar/:id`

**Access:** Active member. Any subset of `title`, `items`, `amount`, `bazarDate`, `shopperId`; at least one field is required. Moving `bazarDate` to another month re-files the entry; both months must be writable.

```json
{
  "title": "Weekly grocery (updated)",
  "amount": 2500,
  "bazarDate": "2026-10-24",
  "shopperId": "0a1b2c3d-0000-4000-8000-000000000006",
  "items": null
}
```

The id is a path parameter; the JSON shows a body example.

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Bazar entry updated successfully",
  "data": {
    "entry": {
      "id": "bb22cc33-0000-4000-8000-000000000030",
      "title": "Weekly grocery (updated)",
      "items": null,
      "amount": 2500,
      "bazarDate": "2026-10-24",
      "shopperId": "0a1b2c3d-0000-4000-8000-000000000006",
      "shopperName": "Rahim Uddin",
      "addedById": "0a1b2c3d-0000-4000-8000-000000000004",
      "addedByName": "Manager",
      "paidFromMessFund": false,
      "receiptUrl": null,
      "createdAt": "2026-10-23T10:00:00.000Z",
      "updatedAt": "2026-10-24T09:00:00.000Z"
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Provide at least one field to update.` / `Amount must be greater than 0.` / invalid date or member id | Validation |
| `403` | `You are not an active member of any mess.` | No active membership |
| `404` | `No bazar entry found with this id in your mess` | Unknown/cross-mess id |
| `404` | `No member found with this id in your mess` | New shopper not in this mess |
| `409` | `Only active members of your mess can be selected as the shopper.` | New shopper not `ACTIVE` |
| `409` | `This month (2026-09) is closed. Reopen it before making changes.` | Old or target month closed |

---

### 32. `DELETE /bazar/:id`

**Access:** Active member. Scoped by the caller's mess.

```json
{
  "bazarId": "bb22cc33-0000-4000-8000-000000000030"
}
```

The id is a path parameter (shown as JSON for reference).

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Bazar entry deleted successfully",
  "data": {
    "id": "bb22cc33-0000-4000-8000-000000000030",
    "deleted": true
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `403` | `You are not an active member of any mess.` | No active membership |
| `404` | `No bazar entry found with this id in your mess` | Unknown/cross-mess id |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

---

### 33. `POST /bazar/:id/receipt`

**Access:** Active member + **PRO**. `multipart/form-data` with one image field named `receipt`. The field must be JPEG, PNG, or WebP, max 5 MB. Uploaded to Cloudinary; the previous asset is destroyed on replace.

JSON description of the multipart request:

```json
{
  "path": {
    "id": "bb22cc33-0000-4000-8000-000000000030"
  },
  "contentType": "multipart/form-data",
  "fields": {
    "receipt": "<binary image: image/jpeg | image/png | image/webp, <= 5 MB>"
  }
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Receipt uploaded successfully",
  "data": {
    "entry": {
      "id": "bb22cc33-0000-4000-8000-000000000030",
      "title": "Weekly grocery",
      "items": "rice, chicken, oil",
      "amount": 2450.5,
      "bazarDate": "2026-10-23",
      "shopperId": "0a1b2c3d-0000-4000-8000-000000000005",
      "shopperName": "Masad Rahman",
      "addedById": "0a1b2c3d-0000-4000-8000-000000000004",
      "addedByName": "Manager",
      "paidFromMessFund": false,
      "receiptUrl": "https://res.cloudinary.com/demo/image/upload/v1/mess-tally/receipt.jpg",
      "createdAt": "2026-10-23T10:00:00.000Z",
      "updatedAt": "2026-10-23T10:05:00.000Z"
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Receipt image is required.` | No file in the `receipt` field |
| `400` | `Only JPEG, PNG, and WebP images are allowed` | Other MIME type |
| `402` | `Bazar receipt uploads is a PRO feature. Ask your mess manager to activate PRO subscription.` | FREE mess |
| `403` | `You are not an active member of any mess.` | No active membership |
| `404` | `No bazar entry found with this id in your mess` | Unknown/cross-mess id |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |
| `413` | `Image must be 5 MB or smaller` | File larger than 5 MB |

---

### 34. `DELETE /bazar/:id/receipt`

**Access:** Active member + **PRO**. Clears `receiptUrl`/`receiptPublicId` and deletes the Cloudinary asset. Idempotent when there is no receipt.

```json
{
  "bazarId": "bb22cc33-0000-4000-8000-000000000030"
}
```

The id is a path parameter (shown as JSON for reference).

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Receipt deleted successfully",
  "data": {
    "entry": {
      "id": "bb22cc33-0000-4000-8000-000000000030",
      "title": "Weekly grocery",
      "items": "rice, chicken, oil",
      "amount": 2450.5,
      "bazarDate": "2026-10-23",
      "shopperId": "0a1b2c3d-0000-4000-8000-000000000005",
      "shopperName": "Masad Rahman",
      "addedById": "0a1b2c3d-0000-4000-8000-000000000004",
      "addedByName": "Manager",
      "paidFromMessFund": false,
      "receiptUrl": null,
      "createdAt": "2026-10-23T10:00:00.000Z",
      "updatedAt": "2026-10-23T10:10:00.000Z"
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `402` | `Bazar receipt uploads is a PRO feature. Ask your mess manager to activate PRO subscription.` | FREE mess |
| `403` | `You are not an active member of any mess.` | No active membership |
| `404` | `No bazar entry found with this id in your mess` | Unknown/cross-mess id |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

## Utilities

Utility bills are independent of meals and bazar: they never affect the meal rate, meal balances, or settlement. All routes require an active membership; **any active member may write bills** (only deposits are manager-only).

A utility bill:

```json
{
  "id": "cc33dd44-0000-4000-8000-000000000040",
  "messMonthId": "4f5e6d7c-0000-4000-8000-000000000010",
  "category": "ELECTRICITY",
  "title": "October electricity",
  "amount": 3200,
  "splitType": "EQUAL",
  "dueDate": "2026-10-30",
  "isPaid": false,
  "paidAt": null,
  "paidById": null,
  "paidByName": null,
  "notes": null,
  "addedById": "0a1b2c3d-0000-4000-8000-000000000004",
  "addedByName": "Manager",
  "createdAt": "2026-10-23T10:00:00.000Z",
  "updatedAt": "2026-10-23T10:00:00.000Z"
}
```

Allowed `category` values: `RENT`, `ELECTRICITY`, `GAS`, `WATER`, `WIFI`, `COOK_SALARY`, `GARBAGE_GUARD`, `SUBSCRIPTION`, `OTHER`.
Allowed `splitType` values: `EQUAL` only (`CUSTOM_WEIGHT` is rejected today).

### 35. `GET /utilities`

**Access:** Active member (+ PRO for a past month). Bills for one month plus totals and the per-person share.

```json
{
  "method": "GET",
  "path": "/api/v1/utilities",
  "query": {
    "month": "2026-10"
  }
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Utility bills fetched successfully",
  "data": {
    "month": {
      "id": "4f5e6d7c-0000-4000-8000-000000000010",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "ACTIVE",
      "exists": true
    },
    "bills": [
      {
        "id": "cc33dd44-0000-4000-8000-000000000040",
        "messMonthId": "4f5e6d7c-0000-4000-8000-000000000010",
        "category": "ELECTRICITY",
        "title": "October electricity",
        "amount": 3200,
        "splitType": "EQUAL",
        "dueDate": "2026-10-30",
        "isPaid": false,
        "paidAt": null,
        "paidById": null,
        "paidByName": null,
        "notes": null,
        "addedById": "0a1b2c3d-0000-4000-8000-000000000004",
        "addedByName": "Manager",
        "createdAt": "2026-10-23T10:00:00.000Z",
        "updatedAt": "2026-10-23T10:00:00.000Z"
      }
    ],
    "totals": {
      "total": 3200,
      "paid": 0,
      "unpaid": 3200,
      "activeMemberCount": 4,
      "perPersonShare": 800
    }
  }
}
```

`perPersonShare = round2(total / activeMemberCount)`, or `0` when there are no active members. A month with no row returns `month.exists = false` and zero totals.

| Status | Development message | Cause |
|---|---|---|
| `400` | `Month must be in YYYY-MM format (for example 2026-10).` | Bad `?month=` |
| `402` | `Past month archives require an active PRO subscription.` | FREE past-month read |
| `403` | `You are not an active member of any mess.` | No active membership |

---

### 36. `POST /utilities`

**Access:** Active member. Creates an unpaid bill in an explicit month. The month is derived from `month` and auto-created if needed.

```json
{
  "month": "2026-10",
  "category": "ELECTRICITY",
  "title": "October electricity",
  "amount": 3200,
  "splitType": "EQUAL",
  "dueDate": "2026-10-30",
  "notes": "Paid by 5th November"
}
```

`month` is required because bills have no natural date. `category` defaults to `OTHER`; `splitType` defaults to `EQUAL`; `dueDate` and `notes` may be `null`; `notes` max 500. `isPaid`, `paidAt`, `paidById`, `paymentId`, `receiptUrl` are never accepted.

Success `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Utility bill created successfully",
  "data": {
    "bill": {
      "id": "cc33dd44-0000-4000-8000-000000000040",
      "messMonthId": "4f5e6d7c-0000-4000-8000-000000000010",
      "category": "ELECTRICITY",
      "title": "October electricity",
      "amount": 3200,
      "splitType": "EQUAL",
      "dueDate": "2026-10-30",
      "isPaid": false,
      "paidAt": null,
      "paidById": null,
      "paidByName": null,
      "notes": "Paid by 5th November",
      "addedById": "0a1b2c3d-0000-4000-8000-000000000004",
      "addedByName": "Manager",
      "createdAt": "2026-10-23T10:00:00.000Z",
      "updatedAt": "2026-10-23T10:00:00.000Z"
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Title is required.` / `Amount must be greater than 0.` / `Invalid utility category.` / `Invalid split type.` / `CUSTOM_WEIGHT split is not supported yet.` / `Month must be in YYYY-MM format (for example 2026-10).` | Validation |
| `403` | `You are not an active member of any mess.` | No active membership |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

---

### 37. `PATCH /utilities/:id`

**Access:** Active member. Any subset of `category`, `title`, `amount`, `splitType`, `dueDate`, `notes`; at least one field. `dueDate` and `notes` accept `null` to clear. A bill cannot move months.

```json
{
  "title": "October electricity (revised)",
  "amount": 3350.75,
  "dueDate": null,
  "notes": null
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Utility bill updated successfully",
  "data": {
    "bill": {
      "id": "cc33dd44-0000-4000-8000-000000000040",
      "messMonthId": "4f5e6d7c-0000-4000-8000-000000000010",
      "category": "ELECTRICITY",
      "title": "October electricity (revised)",
      "amount": 3350.75,
      "splitType": "EQUAL",
      "dueDate": null,
      "isPaid": false,
      "paidAt": null,
      "paidById": null,
      "paidByName": null,
      "notes": null,
      "addedById": "0a1b2c3d-0000-4000-8000-000000000004",
      "addedByName": "Manager",
      "createdAt": "2026-10-23T10:00:00.000Z",
      "updatedAt": "2026-10-24T09:00:00.000Z"
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Provide at least one field to update.` / `Amount can have at most 2 decimal places.` / invalid enum | Validation |
| `403` | `You are not an active member of any mess.` | No active membership |
| `404` | `No utility bill found with this id in your mess` | Unknown/cross-mess id |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

---

### 38. `PATCH /utilities/:id/paid`

**Access:** Active member. Single place where payment state changes. `true` stamps `paidAt = now` and `paidById = caller`; `false` clears both.

```json
{
  "isPaid": true
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Utility bill marked as paid",
  "data": {
    "bill": {
      "id": "cc33dd44-0000-4000-8000-000000000040",
      "messMonthId": "4f5e6d7c-0000-4000-8000-000000000010",
      "category": "ELECTRICITY",
      "title": "October electricity",
      "amount": 3200,
      "splitType": "EQUAL",
      "dueDate": "2026-10-30",
      "isPaid": true,
      "paidAt": "2026-10-24T09:00:00.000Z",
      "paidById": "0a1b2c3d-0000-4000-8000-000000000004",
      "paidByName": "Manager",
      "notes": null,
      "addedById": "0a1b2c3d-0000-4000-8000-000000000004",
      "addedByName": "Manager",
      "createdAt": "2026-10-23T10:00:00.000Z",
      "updatedAt": "2026-10-24T09:00:00.000Z"
    }
  }
}
```

Marking unpaid returns `Utility bill marked as unpaid` with `paidAt: null`, `paidById: null`, `paidByName: null`.

| Status | Development message | Cause |
|---|---|---|
| `400` | `` `isPaid` must be true or false. `` | `isPaid` missing or not a boolean |
| `403` | `You are not an active member of any mess.` | No active membership |
| `404` | `No utility bill found with this id in your mess` | Unknown/cross-mess id |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

---

### 39. `DELETE /utilities/:id`

**Access:** Active member. Deletes one bill.

```json
{
  "billId": "cc33dd44-0000-4000-8000-000000000040"
}
```

The id is a path parameter (shown as JSON for reference).

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Utility bill deleted successfully",
  "data": {
    "id": "cc33dd44-0000-4000-8000-000000000040",
    "deleted": true
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `403` | `You are not an active member of any mess.` | No active membership |
| `404` | `No utility bill found with this id in your mess` | Unknown/cross-mess id |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

---

### 40. `GET /utilities/fund`

**Access:** Active member (+ PRO for a past month). Fund card: deposits collected minus **paid** bills.

```json
{
  "method": "GET",
  "path": "/api/v1/utilities/fund",
  "query": {
    "month": "2026-10"
  }
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Utility fund fetched successfully",
  "data": {
    "month": {
      "id": "4f5e6d7c-0000-4000-8000-000000000010",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "ACTIVE",
      "exists": true
    },
    "totalDeposits": 4000,
    "totalPaidBills": 2500,
    "balance": 1500,
    "needsReplenishment": false
  }
}
```

`balance = round2(totalDeposits - totalPaidBills)`; a negative balance is valid. `needsReplenishment` is `true` when `balance <= 0` (including an empty month). GET never creates a month.

| Status | Development message | Cause |
|---|---|---|
| `400` | `Month must be in YYYY-MM format (for example 2026-10).` | Bad `?month=` |
| `402` | `Past month archives require an active PRO subscription.` | FREE past-month read |
| `403` | `You are not an active member of any mess.` | No active membership |

---

### 41. `GET /utilities/replenishment-estimate`

**Access:** Manager. Formula U3: `perMember × activeMemberCount`.

```json
{
  "method": "GET",
  "path": "/api/v1/utilities/replenishment-estimate",
  "query": {
    "perMember": 500
  }
}
```

`perMember` is required, > 0, max 99,999,999.99, max 2 decimals.

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Replenishment estimate calculated successfully",
  "data": {
    "perMember": 500,
    "activeMemberCount": 3,
    "totalExpected": 1500
  }
}
```

Only `ACTIVE` members are counted; zero active members returns `0`. The current fund balance is **not** subtracted.

| Status | Development message | Cause |
|---|---|---|
| `400` | `Amount must be greater than 0.` / `Amount can have at most 2 decimal places.` / `Amount must be a number.` | Missing/invalid `perMember` |
| `403` | `Manager access is required for this action.` | Not a manager |

---

## Utility fund deposits

`GET` is open to any active member for transparency; every write is **manager-only**. Multiple deposits per member per month are allowed.

A deposit:

```json
{
  "id": "dd44ee55-0000-4000-8000-000000000050",
  "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
  "memberName": "Masad Rahman",
  "memberStatus": "ACTIVE",
  "amount": 1000,
  "date": "2026-10-23",
  "note": "October utility advance",
  "receivedById": "0a1b2c3d-0000-4000-8000-000000000004",
  "receivedByName": "Manager",
  "createdAt": "2026-10-23T10:00:00.000Z",
  "updatedAt": "2026-10-23T10:00:00.000Z"
}
```

### 42. `GET /utilities/fund-deposits`

**Access:** Active member (+ PRO for a past month).

```json
{
  "method": "GET",
  "path": "/api/v1/utilities/fund-deposits",
  "query": {
    "month": "2026-10"
  }
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Fund deposits fetched successfully",
  "data": {
    "month": {
      "id": "4f5e6d7c-0000-4000-8000-000000000010",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "ACTIVE",
      "exists": true
    },
    "deposits": [
      {
        "id": "dd44ee55-0000-4000-8000-000000000050",
        "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
        "memberName": "Masad Rahman",
        "memberStatus": "ACTIVE",
        "amount": 1000,
        "date": "2026-10-23",
        "note": "October utility advance",
        "receivedById": "0a1b2c3d-0000-4000-8000-000000000004",
        "receivedByName": "Manager",
        "createdAt": "2026-10-23T10:00:00.000Z",
        "updatedAt": "2026-10-23T10:00:00.000Z"
      }
    ],
    "total": 1000,
    "byMember": [
      {
        "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
        "name": "Masad Rahman",
        "status": "ACTIVE",
        "count": 1,
        "amount": 1000
      }
    ]
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Month must be in YYYY-MM format (for example 2026-10).` | Bad `?month=` |
| `402` | `Past month archives require an active PRO subscription.` | FREE past-month read |
| `403` | `You are not an active member of any mess.` | No active membership |

---

### 43. `POST /utilities/fund-deposits`

**Access:** Manager. Records money received from a member. The month is derived from `date`; `receivedById` is always the caller.

```json
{
  "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
  "amount": 1000,
  "date": "2026-10-23",
  "note": "October utility advance"
}
```

`date` is optional and defaults to **today's UTC date**. `note` optional/nullable, max 300. `memberId` must be an `ACTIVE` member of the caller's mess.

Success `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Fund deposit recorded successfully",
  "data": {
    "deposit": {
      "id": "dd44ee55-0000-4000-8000-000000000050",
      "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
      "memberName": "Masad Rahman",
      "memberStatus": "ACTIVE",
      "amount": 1000,
      "date": "2026-10-23",
      "note": "October utility advance",
      "receivedById": "0a1b2c3d-0000-4000-8000-000000000004",
      "receivedByName": "Manager",
      "createdAt": "2026-10-23T10:00:00.000Z",
      "updatedAt": "2026-10-23T10:00:00.000Z"
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Invalid member id.` / `Amount must be greater than 0.` / `Date must be in YYYY-MM-DD format.` | Validation |
| `403` | `Manager access is required for this action.` | Not a manager |
| `404` | `No member found with this id in your mess` | Unknown/cross-mess member |
| `409` | `Only active members of your mess can make a deposit.` | Member not `ACTIVE` |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

---

### 44. `PATCH /utilities/fund-deposits/:id`

**Access:** Manager. Any subset of `memberId`, `amount`, `date`, `note`; at least one field. Changing `date` may move the deposit to another month; both months must be writable. `receivedById` never changes.

```json
{
  "amount": 1200,
  "date": "2026-10-25",
  "note": "Corrected amount"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Fund deposit updated successfully",
  "data": {
    "deposit": {
      "id": "dd44ee55-0000-4000-8000-000000000050",
      "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
      "memberName": "Masad Rahman",
      "memberStatus": "ACTIVE",
      "amount": 1200,
      "date": "2026-10-25",
      "note": "Corrected amount",
      "receivedById": "0a1b2c3d-0000-4000-8000-000000000004",
      "receivedByName": "Manager",
      "createdAt": "2026-10-23T10:00:00.000Z",
      "updatedAt": "2026-10-25T09:00:00.000Z"
    }
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Provide at least one field to update.` / invalid member id, amount, or date | Validation |
| `403` | `Manager access is required for this action.` | Not a manager |
| `404` | `No deposit found with this id in your mess` | Unknown/cross-mess id |
| `404` | `No member found with this id in your mess` | New member not in this mess |
| `409` | `Only active members of your mess can make a deposit.` | New member not `ACTIVE` |
| `409` | `This month (2026-09) is closed. Reopen it before making changes.` | Old or target month closed |

---

### 45. `DELETE /utilities/fund-deposits/:id`

**Access:** Manager. Deletes one deposit.

```json
{
  "depositId": "dd44ee55-0000-4000-8000-000000000050"
}
```

The id is a path parameter (shown as JSON for reference).

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Fund deposit deleted successfully",
  "data": {
    "id": "dd44ee55-0000-4000-8000-000000000050",
    "deleted": true
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `403` | `Manager access is required for this action.` | Not a manager |
| `404` | `No deposit found with this id in your mess` | Unknown/cross-mess id |
| `409` | `This month (2026-10) is closed. Reopen it before making changes.` | Closed month |

## Summary

Meal accounting only: summary uses `meal_entry` and `meal_expense`. Utility bills and fund deposits are never included in its totals.

### 46. `GET /summary`

**Access:** Active member (+ PRO for a past month). Month defaults to the current `APP_TIMEZONE` month. A `CLOSED` month returns the snapshot written at close time, not a live recalculation.

Included members: every `ACTIVE` member, plus any non-active member with meal or bazar data in that month (normally `LEFT`). `LEFT` members with no data are excluded. `guestMeals` count in `totalMeals`. `bazarPaid` is the sum of trips where the member is the **shopper**, not the recorder.

```json
{
  "method": "GET",
  "path": "/api/v1/summary",
  "query": {
    "month": "2026-10"
  }
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Summary fetched successfully",
  "data": {
    "month": {
      "id": "4f5e6d7c-0000-4000-8000-000000000010",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "ACTIVE",
      "exists": true
    },
    "canSettle": true,
    "totals": {
      "totalMeals": 30,
      "totalBazar": 3000,
      "mealRate": 100,
      "totalPositiveBalance": 2000
    },
    "members": [
      {
        "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
        "name": "Masad Rahman",
        "avatarUrl": null,
        "status": "ACTIVE",
        "totalMeals": 10,
        "mealCost": 1000,
        "bazarPaid": 3000,
        "mealBalance": 2000,
        "balanceStatus": "RECEIVER"
      }
    ],
    "settlement": [
      {
        "fromMemberId": "0a1b2c3d-0000-4000-8000-000000000006",
        "toMemberId": "0a1b2c3d-0000-4000-8000-000000000005",
        "amount": 2000
      }
    ],
    "isLocked": false
  }
}
```

Rules:

- `mealRate = totalBazar / totalMeals`, or `0` when there are no meals.
- `mealBalance = bazarPaid - mealCost`; `balanceStatus` is `RECEIVER` (> 0), `GIVER` (< 0), or `SETTLED` (= 0).
- Do not recompute `mealCost` from the rounded `mealRate`; use the returned value. Balances are reconciled to paise so the settlement sums to zero.
- If meals are 0 but bazar is positive, every balance is positive, `canSettle` is `false`, and `settlement` is empty.
- A month with no row returns `200`, `month.exists = false`, zero totals, current active members at zero, and never creates a row.

| Status | Development message | Cause |
|---|---|---|
| `400` | `Month must be in YYYY-MM format (for example 2026-10).` | Bad `?month=` |
| `402` | `Past month archives require an active PRO subscription.` | FREE past-month read |
| `403` | `You are not an active member of any mess.` | No active membership |

---

### 47. `GET /summary/export`

**Access:** Active member (+ PRO for a past month). Uses the same service as `GET /summary`, so a closed month exports the locked snapshot.

```json
{
  "method": "GET",
  "path": "/api/v1/summary/export",
  "query": {
    "month": "2026-10",
    "format": "json"
  }
}
```

`month` defaults to the current month; `format` is `csv` (default) or `json`.

`format=json` returns the standard envelope with `data` identical to `GET /summary`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Summary exported successfully",
  "data": {
    "month": {
      "id": "4f5e6d7c-0000-4000-8000-000000000010",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "ACTIVE",
      "exists": true
    },
    "canSettle": true,
    "totals": {
      "totalMeals": 30,
      "totalBazar": 3000,
      "mealRate": 100,
      "totalPositiveBalance": 2000
    },
    "members": [],
    "settlement": [],
    "isLocked": false
  }
}
```

`format=csv` returns a file (JSON description of the response):

```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": "attachment; filename=\"mess-tally-summary-2026-10.csv\""
  },
  "body": "\uFEFFMonth,2026-10\r\nStatus,ACTIVE\r\n..."
}
```

The CSV starts with a UTF-8 BOM, uses CRLF and RFC 4180 escaping, and contains totals, a member table, and the settlement list.

| Status | Development message | Cause |
|---|---|---|
| `400` | `Month must be in YYYY-MM format (for example 2026-10).` / `Invalid option: expected one of "csv"\|"json"` | Bad query |
| `402` | `Past month archives require an active PRO subscription.` | FREE past-month read |
| `403` | `You are not an active member of any mess.` | No active membership |

---

### 48. `GET /summary/statement`

**Access:** Active member + **PRO**. Returns the caller's PDF statement, **closed months only**.

```json
{
  "method": "GET",
  "path": "/api/v1/summary/statement",
  "query": {
    "month": "2026-10"
  }
}
```

`month` is optional and defaults to the current month, but the endpoint succeeds only when that month is `CLOSED`.

Success `200` (JSON description of the binary response):

```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/pdf"
  },
  "body": "<PDF binary containing totals, meal rate, meal cost, bazar paid and balance>"
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `Month must be in YYYY-MM format (for example 2026-10).` | Bad `?month=` |
| `402` | `PDF statements is a PRO feature. Ask your mess manager to activate PRO subscription.` | FREE mess |
| `403` | `You are not an active member of any mess.` | No active membership |
| `404` | `No statement data found for this member.` | Caller is not in the snapshot (joined later) |
| `409` | `PDF statements are available only for closed months.` | Month not `CLOSED` |

---

## Dashboard

### 49. `GET /dashboard`

**Access:** Active member (+ PRO for a past month). One read-only payload combining the Summary meal block and the Utility Fund block, with the caller's own ledger. Numbers match the dedicated pages because the same services are used.

```json
{
  "method": "GET",
  "path": "/api/v1/dashboard",
  "query": {
    "month": "2026-10"
  }
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Dashboard fetched successfully",
  "data": {
    "month": {
      "id": "4f5e6d7c-0000-4000-8000-000000000010",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "ACTIVE",
      "exists": true
    },
    "meal": {
      "totalMeals": 30,
      "totalBazar": 3000,
      "mealRate": 100,
      "me": {
        "memberId": "0a1b2c3d-0000-4000-8000-000000000005",
        "totalMeals": 10,
        "mealCost": 1000,
        "bazarPaid": 3000,
        "mealBalance": 2000,
        "balanceStatus": "RECEIVER"
      }
    },
    "utility": {
      "totalDeposits": 4000,
      "totalPaidBills": 2500,
      "balance": 1500,
      "needsReplenishment": false
    },
    "pendingMemberCount": 2
  }
}
```

- `pendingMemberCount` is a number for managers and `null` for other members.
- No settlement list is returned; use `GET /summary`.
- A month with no row returns zero meal values for the caller and zero fund values, without creating a month.
- If the caller joined after a closed month was finalized, `meal.me` is a zero row.

| Status | Development message | Cause |
|---|---|---|
| `400` | `Month must be in YYYY-MM format (for example 2026-10).` | Bad `?month=` |
| `402` | `Past month archives require an active PRO subscription.` | FREE past-month read |
| `403` | `You are not an active member of any mess.` | No active membership |

---

## Profile

### 50. `PATCH /profile/image`

**Access:** Auth. `multipart/form-data` with one image field named `profileImage` (JPEG, PNG, or WebP, max 5 MB). Uploads to Cloudinary, replaces the previous asset, and returns the profile row.

JSON description of the multipart request:

```json
{
  "contentType": "multipart/form-data",
  "fields": {
    "profileImage": "<binary image: image/jpeg | image/png | image/webp, <= 5 MB>"
  }
}
```

Success `201`:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Profile image uploaded successfully",
  "data": {
    "id": "b2b0b8f0-0000-4000-8000-000000000002",
    "userId": "7c1e0f9a-0000-4a00-9000-000000000001",
    "imageUrl": "https://res.cloudinary.com/demo/image/upload/v1/mess-tally/avatars/abc.jpg",
    "imagePublicId": "mess-tally/avatars/abc",
    "bio": "Backend developer",
    "phone": "+8801700000000",
    "address": "Dhaka",
    "createdAt": "2026-10-23T10:00:00.000Z",
    "updatedAt": "2026-10-23T10:05:00.000Z"
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `No file uploaded` | Missing `profileImage` field |
| `400` | `Only JPEG, PNG, and WebP images are allowed` | Other MIME type |
| `401` | `You are not logged in. Please log in to access this resource.` | No/invalid token |
| `413` | `Image must be 5 MB or smaller` | File too large |
| `500` | Cloudinary/Prisma error text | Upload or DB failure |

---

### 51. `PATCH /profile/update`

**Access:** Auth. Partial profile update; at least one field is required. Upserts the profile row for the caller.

```json
{
  "bio": "Backend developer, meal enthusiast",
  "phone": "+8801700000000",
  "address": "House 12, Road 4, Dhaka"
}
```

`bio` max 500; `phone` max 20, pattern `^\+?[0-9\s()-]{6,20}$`; `address` max 255.

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Profile updated successfully",
  "data": {
    "id": "b2b0b8f0-0000-4000-8000-000000000002",
    "userId": "7c1e0f9a-0000-4a00-9000-000000000001",
    "imageUrl": null,
    "imagePublicId": null,
    "bio": "Backend developer, meal enthusiast",
    "phone": "+8801700000000",
    "address": "House 12, Road 4, Dhaka",
    "createdAt": "2026-10-23T10:00:00.000Z",
    "updatedAt": "2026-10-23T10:10:00.000Z"
  }
}
```

| Status | Development message | Cause |
|---|---|---|
| `400` | `At least one field must be provided` / `Enter a valid phone number` / `Bio must be at most 500 characters` | Validation |
| `403` | `User is inactive or deleted` / `User is suspended` / `Email is not verified` | Account state |
| `404` | `User not found` | User row missing |

---

## Subscription

PRO is purchased through bKash. A mess is PRO only while `plan = PRO` and `planExpiresAt` is in the future. Plans:

| `plan` | Duration | Default price |
|---|---|---|
| `MONTHLY` | 30 days | 100 BDT |
| `HALF_YEARLY` | 180 days | 500 BDT |
| `YEARLY` | 365 days | 1000 BDT |

Prices come from `PRO_PRICE_1_MONTH`, `PRO_PRICE_6_MONTH`, `PRO_PRICE_12_MONTH`.

### 52. `GET /subscription/callback`

**Access:** Public. Called by bKash, not by the app. It **always responds with `302`** to the frontend billing page and never returns JSON, even on failure.

```json
{
  "method": "GET",
  "path": "/api/v1/subscription/callback",
  "query": {
    "paymentID": "TR0011abcde",
    "status": "success"
  }
}
```

Behavior:

- Missing `paymentID`/`paymentId` or `status` → redirect `?payment=failure`.
- Unknown payment → redirect `?payment=failure`.
- `status != "success"` → payment becomes `CANCELLED` (for `cancel`) or `FAILED`, redirect `?payment=cancel|failure`.
- `success` → executes/queries the payment; verifies amount, `trxID`, `paymentID`, invoice, and currency; on success marks `PAID`, extends PRO, redirects `?payment=success` (or `pending` if the gateway has not completed).
- Any internal error → redirect `?payment=failure` (or `cancel`), with the raw gateway answer stored on the payment row when possible.

Response headers:

```json
{
  "statusCode": 302,
  "headers": {
    "Location": "http://localhost:3000/settings/billing?payment=success&paymentId=ee55ff66-0000-4000-8000-000000000060&gatewayPaymentId=TR0011abcde"
  }
}
```

**Failures never produce a JSON error** — this table is the error surface for the endpoint:

| Condition | Status | Effect |
|---|---|---|
| `paymentID`/`paymentId` or `status` missing | `302` | `Location: ...?payment=failure` |
| Unknown `paymentID` | `302` | `Location: ...?payment=failure` |
| `status=cancel` | `302` | Payment row becomes `CANCELLED`, `?payment=cancel` |
| `status=failure` (or any non-`success`) | `302` | Payment row becomes `FAILED`, `?payment=failure` |
| `status=success`, gateway still processing | `302` | Payment stays `PENDING`, `?payment=pending` |
| `status=success`, amount/`trxID`/`paymentID`/invoice/currency mismatch | `302` | `?payment=failure`; mismatch reason logged |
| Any thrown error (DB, network, malformed query) | `302` | `?payment=failure` (or `cancel`), raw gateway answer stored when possible |

---

### 53. `GET /subscription`

**Access:** Active member. Returns the current plan, limits, feature flags, and purchasable options.

```json
{
  "method": "GET",
  "path": "/api/v1/subscription"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Subscription fetched successfully",
  "data": {
    "plan": "PRO",
    "isPro": true,
    "planExpiresAt": "2026-11-22T10:00:00.000Z",
    "limits": {
      "maxActiveMembers": null
    },
    "features": {
      "bazarReceiptUploads": true,
      "selfServiceMeals": true,
      "pastMonthArchives": true,
      "pdfStatements": true
    },
    "options": [
      {
        "key": "MONTHLY",
        "label": "1 Month",
        "durationDays": 30,
        "price": 100,
        "currency": "BDT"
      },
      {
        "key": "HALF_YEARLY",
        "label": "6 Months",
        "durationDays": 180,
        "price": 500,
        "currency": "BDT"
      },
      {
        "key": "YEARLY",
        "label": "1 Year",
        "durationDays": 365,
        "price": 1000,
        "currency": "BDT"
      }
    ]
  }
}
```

For FREE: `plan: "FREE"`, `isPro: false`, `maxActiveMembers: 5`, all feature flags `false`.

| Status | Development message | Cause |
|---|---|---|
| `403` | `You are not an active member of any mess.` | No active membership |

---

### 54. `POST /subscription/activate`

**Access:** Manager. Creates a bKash checkout for the mess and returns the gateway URL. Only one `PENDING` payment per mess is allowed; a pending payment older than 30 minutes is released automatically.

```json
{
  "plan": "MONTHLY"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "bKash payment created successfully",
  "data": {
    "paymentId": "ee55ff66-0000-4000-8000-000000000060",
    "paymentURL": "https://sandbox.bka.sh/v1.2.0-beta/bkash/payment/checkout/TR0011abcde"
  }
}
```

The `paymentId` is local; poll `GET /subscription/payments/:id/status` after the user returns.

| Status | Development message | Cause |
|---|---|---|
| `400` | `Invalid subscription plan.` / Zod enum message | Unknown plan |
| `403` | `Manager access is required for this action.` | Not a manager |
| `409` | `There is already a pending subscription payment for this mess.` | Unfinished checkout |
| `502` | `bKash did not return a payment URL.` | Gateway response missing `bkashURL`/`paymentID` |
| `500` | bKash/network error text | Gateway call failed; payment is marked `FAILED` |

---

### 55. `GET /subscription/payments`

**Access:** Active member. Payment history for the caller's mess, newest first.

```json
{
  "method": "GET",
  "path": "/api/v1/subscription/payments"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Subscription payments fetched successfully",
  "data": [
    {
      "id": "ee55ff66-0000-4000-8000-000000000060",
      "type": "SUBSCRIPTION_MONTHLY",
      "status": "PAID",
      "amount": 100,
      "currency": "BDT",
      "durationDays": 30,
      "periodStart": "2026-10-23T10:00:00.000Z",
      "periodEnd": "2026-11-22T10:00:00.000Z",
      "paidAt": "2026-10-23T10:01:00.000Z",
      "bkashTrxId": "TR0011abcde",
      "createdAt": "2026-10-23T10:00:00.000Z"
    }
  ]
}
```

`amount` is a JSON number. `status` is `UNPAID | PENDING | PAID | FAILED | CANCELLED | REFUNDED`.

| Status | Development message | Cause |
|---|---|---|
| `403` | `You are not an active member of any mess.` | No active membership |

---

### 56. `GET /subscription/payments/:id/status`

**Access:** Active member, scoped to the caller's mess. Reconciles a pending payment directly with bKash (idempotent). If the payment is already `PAID` or has no gateway id, the stored row is returned without calling bKash.

```json
{
  "method": "GET",
  "path": "/api/v1/subscription/payments/ee55ff66-0000-4000-8000-000000000060/status"
}
```

Success `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Subscription payment reconciled successfully",
  "data": {
    "id": "ee55ff66-0000-4000-8000-000000000060",
    "messId": "1f2e3d4c-0000-4000-8000-000000000003",
    "paidByMemberId": "0a1b2c3d-0000-4000-8000-000000000004",
    "type": "SUBSCRIPTION_MONTHLY",
    "status": "PAID",
    "amount": "100",
    "currency": "BDT",
    "durationDays": 30,
    "paymentGateway": "bkash",
    "merchantInvoiceNumber": "SUB-1761200000000-1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
    "bkashPaymentId": "TR0011abcde",
    "bkashTrxId": "TRX123456",
    "payerReference": "7c1e0f9a-0000-4a00-9000-000000000001",
    "periodStart": "2026-10-23T10:00:00.000Z",
    "periodEnd": "2026-11-22T10:00:00.000Z",
    "paidAt": "2026-10-23T10:01:00.000Z",
    "gatewayResponse": { "...": "raw bKash response" },
    "createdAt": "2026-10-23T10:00:00.000Z",
    "updatedAt": "2026-10-23T10:01:00.000Z"
  }
}
```

> This endpoint returns the raw Prisma payment row (unlike `/payments`, `amount` is a decimal string).

| Status | Development message | Cause |
|---|---|---|
| `403` | `You are not an active member of any mess.` | No active membership |
| `404` | `Subscription payment not found.` | Unknown/cross-mess payment id |
| `502` | `bKash amount does not match the subscription payment.` / `bKash did not return a transaction id.` / `bKash paymentID does not match the stored checkout.` / other mismatch messages | Gateway verification failed |
| `500` | gateway/network error text | Status query failed |

## Global error reference

Every JSON error uses the same envelope. In development `message` is the specific text listed in each endpoint table; outside development it is always `"Internal Server Error"`.

```json
{
  "success": false,
  "statusCode": 400,
  "name": "Bad Request",
  "message": "Month must be in YYYY-MM format (for example 2026-10).",
  "error": {},
  "stack": "development only"
}
```

### Status codes produced by this API

| Status | `name` | When it happens | What the client should do |
|---|---|---|---|
| `400` | `Bad Request` | Zod validation failure, invalid path/query value, malformed id, `PATCH` with no fields, budget/amount rule violation, Prisma validation, `P2002`, `P2003`, `P2025` | Fix the request; show `message` to the user |
| `401` | `Unauthorized` | Missing/invalid/expired access token, failed refresh token, deleted or inactive account | Clear the session and redirect to login |
| `402` | `Payment Required` | FREE mess hits a PRO feature: past-month archive read, receipt upload/delete, self-service meals, PDF statement | Show the upgrade prompt for the mess |
| `403` | `Forbidden` | No active membership, outside subscription window, not a manager, not the owner, or an account-state failure (`User is Suspended`, `Email is not verified`) | Show the permission message; do not retry |
| `404` | `Not Found` | Resource id not in the caller's mess, unknown room code, unknown payment, or an unknown route (the `notFound` handler uses a different body shape) | Treat as "not available to this account" |
| `409` | `Conflict` | Closed month, locked meal entry, duplicate pending payment, already-active membership, FREE member cap, ownership/manager rule, serialization retry exhausted | Reload the resource before retrying |
| `413` | `Payload Too Large` | Multer `LIMIT_FILE_SIZE` — uploaded image larger than 5 MB | Reject the file client-side (5 MB limit) |
| `429` | `Too Many Requests` | OTP resend cooldown (60 s), 3rd resend, 5th wrong OTP attempt | Wait and retry; surface the remaining time |
| `500` | `Internal Server Error` | Unhandled `Error`, Cloudinary/SMTP/Redis/bKash failure, or `PrismaClientUnknownRequestError` | Generic failure message; retrying may help only if transient |
| `502` | `Bad Gateway` | bKash response rejected: missing payment URL, amount/`trxID`/`paymentID`/currency mismatch | Treat the payment as unfinished; poll the status route |
| `503` | `Service Unavailable` | Transient DB failure — socket codes `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `EPIPE` or Prisma `P1001`, `P1002`, `P1008`, `P1017`, `P2024` (and initialization `P1001`) | Retry with backoff |

### Prisma mapping

| Prisma error | Status | Message |
|---|---|---|
| `PrismaClientValidationError` | `400` | `You have provided incorrect field type or missing fields` |
| `PrismaClientKnownRequestError` `P2002` | `400` | `Duplicate Key Error` |
| `PrismaClientKnownRequestError` `P2003` | `400` | `Foreign key constraint failed` |
| `PrismaClientKnownRequestError` `P2025` | `400` | `An operation failed because it depends on one or more records that were required but not found.` |
| `PrismaClientKnownRequestError` transient code | `503` | `The database is temporarily unavailable. Please try again in a moment.` |
| `PrismaClientInitializationError` `P1000` | `401` | `Authentication failed against database server. Please Check Your Credentials` |
| `PrismaClientInitializationError` `P1001` | `503` | `Can't reach database server` |
| `PrismaClientUnknownRequestError` | `500` | `Error occurred during query execution` |

### JWT and multer mapping

| Error | Status | Message |
|---|---|---|
| `jwt.TokenExpiredError` | `401` | `Your session has expired. Please log in again.` |
| `jwt.JsonWebTokenError` | `401` | `Invalid access token. Please log in again.` |
| `MulterError` `LIMIT_FILE_SIZE` | `413` | `Image must be 5 MB or smaller` |
| Other `MulterError` | `400` | Multer's own message (e.g. unexpected field) |

### Error behavior worth remembering

- **Production masks every message.** `name` becomes `"Internal Server Error"` and `error`/`stack` are omitted, so branch on `statusCode` only.
- **`validateRequest` reports only the first Zod issue** and replaces `req.body` with the parsed value, so unknown fields are stripped before it reaches the service.
- **`checkAuth` throws `AppError`**, so missing/invalid tokens return `401` and a role mismatch would return `403` with the real message. Every route currently allows `USER`, `ADMIN`, and `SUPERADMIN`, so that role branch is never hit in practice; there is no admin override for mess-level rules.
- **Unknown routes** return `{ "message": "Route not found", "path": "...", "date": "..." }` with status `404` and no `success`/`statusCode` fields.
- **The bKash callback never errors as JSON.** `GET /subscription/callback` always answers `302`, using the `payment` query flag to report the outcome.
- **Cross-mess ids are `404`, not `403`**, so a caller can never confirm that a resource exists in another mess.
