# MessTally API Contract — Phase 2 Dev A (Months and Meals)

Base URL: `{{baseUrl}}` (default `http://localhost:8000`)
All routes below are mounted under `/api/v1`.

## Auth and mess scope

- Every route requires a valid access token (`Authorization: Bearer <token>` or the `accessToken` httpOnly cookie).
- **The JWT is identity-only:** `{ userId, name, email, role }`. No `messId` claim is added.
- The server resolves the caller's mess from `user.activeMessId` and verifies the matching `mess_member` row is `ACTIVE` (`requireActiveMembership`).
- No request body or query may select a mess. Cross-mess ids return `404`.

Success envelope:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "…",
  "data": {}
}
```

Error envelope (from the global handler):

```json
{
  "success": false,
  "statusCode": 409,
  "name": "Conflict",
  "message": "This month (2026-10) is closed. Reopen it before making changes."
}
```

## Month rules

- `name` is always `YYYY-MM`.
- `startDate` is the first day and `endDate` the last day of the month, `YYYY-MM-DD`, UTC-safe.
- A missing `mess_month` row is auto-created as `ACTIVE` on the first meal write (decision D1).
- Reads never create a month row.
- Writes to a `CLOSED` month return `409` (decision D2). Reopening is Phase 4.
- Month requests use UTC. `?month=` should always be sent by the frontend to avoid host-timezone ambiguity.

## Months

### `GET /api/v1/months`

Any `ACTIVE` member. Returns months newest first.

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Months fetched successfully",
  "data": {
    "months": [
      {
        "id": "uuid",
        "name": "2026-10",
        "startDate": "2026-10-01",
        "endDate": "2026-10-31",
        "status": "ACTIVE",
        "managerId": "uuid",
        "closedAt": null,
        "isCurrent": true
      }
    ],
    "total": 1
  }
}
```

### `POST /api/v1/months`

Manager only.

```json
{ "month": "2026-10" }
```

| Case | Status | Response |
|---|---|---|
| Created | `201` | `{ month, created: true }` |
| Already `ACTIVE` | `200` | `{ month, created: false }` |
| Already `CLOSED` | `409` | `This month (…) is already closed…` |
| Invalid `YYYY-MM` | `400` | Format message |
| Not a manager | `403` | Manager access required |

## Meals

Meal counts are non-negative finite numbers; fractions such as `0.5` are allowed.
`guestMeals` counts toward the cell total, per-member total and house total.

### `GET /api/v1/meals?month=YYYY-MM`

Any `ACTIVE` member. `month` is optional and defaults to the current UTC month.

Returns a **dense grid**: every day × every `ACTIVE` member. `LEFT` members appear
only if they have entries in the month (read-only, `status: "LEFT"`), so historical
data does not disappear after someone leaves.

A month with no row is still `200`: `month.exists = false`, `month.id = null`, and
all cells are zero. This read does not create a month row.

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "month": {
      "id": null,
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": null,
      "exists": false
    },
    "days": ["2026-10-01", "2026-10-02"],
    "members": [
      {
        "memberId": "uuid",
        "name": "Masad",
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
          }
        ],
        "totals": {
          "breakfast": 0,
          "lunch": 0,
          "dinner": 0,
          "guestMeals": 0,
          "total": 0
        }
      }
    ],
    "houseTotals": {
      "breakfast": 0,
      "lunch": 0,
      "dinner": 0,
      "guestMeals": 0,
      "total": 0
    }
  }
}
```

### `PUT /api/v1/meals`

Any `ACTIVE` member. Replaces one whole cell, so all four counts are required.

```json
{
  "memberId": "uuid",
  "date": "2026-10-03",
  "breakfast": 1,
  "lunch": 2,
  "dinner": 1,
  "guestMeals": 0
}
```

Rules:

- `date` must be a real calendar date; `2026-02-30` is rejected.
- The month is derived from `date`, auto-created, and checked for `CLOSED`.
- The member must be `ACTIVE` in the caller's mess.
- Upsert on `(messMonthId, memberId, date)` — idempotent.
- Existing `isLocked` entry → `409`.
- `updatedById` is always the caller, never the body.

Response `200`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Meal entry saved successfully",
  "data": {
    "entry": {
      "id": "uuid",
      "messMonthId": "uuid",
      "memberId": "uuid",
      "date": "2026-10-03",
      "breakfast": 1,
      "lunch": 2,
      "dinner": 1,
      "guestMeals": 0,
      "total": 4,
      "isLocked": false,
      "updatedById": "uuid",
      "updatedAt": "2026-10-03T12:00:00.000Z"
    }
  }
}
```

| Case | Status |
|---|---|
| Missing/invalid/negative field | `400` |
| Cross-mess or unknown member | `404` |
| Member exists but not `ACTIVE` | `409` |
| Closed month or locked entry | `409` |

### `POST /api/v1/meals/bulk`

Any `ACTIVE` member. One daily sheet, 1–200 members, one transaction.

```json
{
  "date": "2026-10-03",
  "entries": [
    {
      "memberId": "uuid",
      "breakfast": 1,
      "lunch": 2,
      "dinner": 1,
      "guestMeals": 0
    }
  ]
}
```

- Duplicate `memberId` in the payload → `400`.
- Any invalid member, non-active member, closed month or locked existing cell rejects
  the entire batch and nothing is written.
- Response `200`: `{ entries: [ … ] }`.

### `DELETE /api/v1/meals/:id`

Any `ACTIVE` member.

- Lookup is scoped by `id` **and** the caller's mess: cross-mess id → `404`.
- `isLocked` entry → `409`; `CLOSED` month → `409`.
- Response `200`: `{ id, deleted: true }`.

## Status code summary

| Code | Meaning |
|---|---|
| `400` | Bad month/date, negative or non-numeric meals, bad bulk payload |
| `401` | Missing/invalid token |
| `403` | No active membership, or non-manager opening a month |
| `404` | Month/member/meal not found in the caller's mess |
| `409` | Closed month, locked entry, non-active member, closing an already-closed month |

## For Dev B (Bazar and Utilities)

Import the shared month helpers instead of duplicating date logic:

```ts
import {
  getOrCreateMonthByDate,
  assertMonthWritable,
  getMonthByDate,
} from "../messMonth/month.service";

import {
  parseMonthParam,
  monthRangeFromDate,
  parseDateOnly,
  formatDateOnly,
  listMonthDays,
  round2,
} from "../messMonth/month.util";
```

Usage on every write:

```ts
const date = parseDateOnly("2026-10-03");
const month = await getOrCreateMonthByDate(
  actor.messId,
  date,
  actor.isManager ? actor.id : null,
);
assertMonthWritable(month);
// write row with month.id
```

`getOrCreateMonthByDate` does **not** assert writability because reads may target a
closed month. Always call `assertMonthWritable` on writes.
