# MessTally API Contract

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
- Writes to a `CLOSED` month return `409` (decision D2). A manager can reopen it with `PATCH /api/v1/months/:id/reopen`.
- Closing a month snapshots the meal summary and utility totals. Summary reads for that month use the snapshot until it is reopened.
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

### `PATCH /api/v1/months/:id/close`

Manager only. Finalizes the month in one serializable transaction:

- computes the meal summary and utility totals from the current data
- stores `lockedMealRate`, `lockedTotalMeals`, `lockedTotalBazar`, `lockedTotalUtilities`
- stores the versioned `lockedSnapshot` (summary, settlement and utility audit data)
- sets `status = CLOSED`, `closedAt` and `closedById`
- sets `isLocked = true` on every meal entry in the month

`lockedTotalUtilities` is the sum of **all** utility bills in the month, paid and unpaid. Utility values are stored for audit only and never enter Summary/export meal figures.

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Month closed successfully",
  "data": {
    "month": {
      "id": "uuid",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "CLOSED",
      "managerId": "uuid",
      "closedAt": "2026-10-31T12:00:00.000Z",
      "isCurrent": true
    }
  }
}
```

| Case | Status |
|---|---|
| Month closed | `200` |
| Month id not in caller's mess | `404` |
| Already `CLOSED` | `409` |
| Not a manager | `403` |

Closing is allowed even when the summary cannot settle (`canSettle: false`); the snapshot preserves that state and the empty settlement.

### `PATCH /api/v1/months/:id/reopen`

Manager only. Sets the month back to `ACTIVE`, clears `closedAt`, `closedById`, all `locked*` columns and `lockedSnapshot`, and sets `isLocked = false` on every meal entry in the month. Returns the same `{ month }` shape with `status: "ACTIVE"` and `closedAt: null`.

| Case | Status |
|---|---|
| Month reopened | `200` |
| Month id not in caller's mess | `404` |
| Already `ACTIVE` | `409` |
| Not a manager | `403` |

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

## Bazar

All routes require an `ACTIVE` membership. Any `ACTIVE` member can read or write bazar entries (D3).

### `GET /api/v1/bazar?month=&shopperId=&from=&to=`

`month` defaults to the current UTC month. `from`/`to` are inclusive date-only
filters that must stay inside the selected month. A month with no row returns
`200` with `month.exists = false` and zero totals; GET never creates a month.

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "month": {
      "id": "uuid",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "ACTIVE",
      "exists": true
    },
    "entries": [
      {
        "id": "uuid",
        "title": "Weekly grocery",
        "items": "rice, chicken",
        "amount": 2450.5,
        "bazarDate": "2026-10-23",
        "shopperId": "uuid",
        "shopperName": "Masad",
        "addedById": "uuid",
        "addedByName": "Masad",
        "paidFromMessFund": false,
        "createdAt": "2026-10-23T10:00:00.000Z",
        "updatedAt": "2026-10-23T10:00:00.000Z"
      }
    ],
    "totals": {
      "houseTotal": 2450.5,
      "byShopper": [
        {
          "memberId": "uuid",
          "name": "Masad",
          "count": 1,
          "amount": 2450.5
        }
      ]
    }
  }
}
```

Entries are sorted by `bazarDate` then `createdAt`, ascending.

### `POST /api/v1/bazar`

```json
{
  "title": "Weekly grocery",
  "items": "rice, chicken",
  "amount": 2450.5,
  "bazarDate": "2026-10-23",
  "shopperId": "uuid"
}
```

- `title` is optional and defaults to `"Bazar"`.
- `items` is optional.
- `amount` must be finite, `> 0`, at most 2 decimals, max `99,999,999.99`.
- `shopperId` must be an `ACTIVE` member of the caller's mess.
- The month is derived from `bazarDate` and auto-created (D1).
- `addedById` is the caller; `paidFromMessFund` is forced `false` (D11). Neither is
  accepted from the client.
- Response `201`: `{ entry }`.

### `PATCH /api/v1/bazar/:id`

Accepts any subset of `title`, `items`, `amount`, `bazarDate`, `shopperId`.
At least one field is required.

Changing `bazarDate` across a month boundary moves the entry to the target
month; both the old and target months must be `ACTIVE`. If the shopper later
became `LEFT`, editing other fields still works; supplying a new `shopperId`
requires an `ACTIVE` member.

Response `200`: `{ entry }`.

### `DELETE /api/v1/bazar/:id`

Scoped by the caller's mess. A `CLOSED` month returns `409`.
Response `200`: `{ id, deleted: true }`.

## Utilities

All routes require an `ACTIVE` membership. Any `ACTIVE` member can write bills
(D4). Utility data never affects meals, bazar, the meal rate or settlement
(AC 5.1.4).

### `GET /api/v1/utilities?month=`

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "month": {
      "id": "uuid",
      "name": "2026-10",
      "startDate": "2026-10-01",
      "endDate": "2026-10-31",
      "status": "ACTIVE",
      "exists": true
    },
    "bills": [
      {
        "id": "uuid",
        "messMonthId": "uuid",
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
        "addedById": "uuid",
        "addedByName": "Masad",
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

- `perPersonShare` is formula U1: total bills ÷ ACTIVE member count, rounded to
  2 decimals. It is `0` when the count is zero (AC 5.1.2, AC 5.1.3).
- `paid`/`unpaid` split on `isPaid`; both are included in `total`.
- A month with no row returns `200` with `month.exists = false` and zero totals.

### `POST /api/v1/utilities`

```json
{
  "month": "2026-10",
  "category": "ELECTRICITY",
  "title": "October electricity",
  "amount": 3200,
  "dueDate": "2026-10-30",
  "notes": null
}
```

- `month` is required because bills have no natural date.
- `category` defaults to `OTHER`.
- `splitType` defaults to `EQUAL`; `CUSTOM_WEIGHT` returns `400`.
- New bills are always unpaid. Payment state changes only through `/:id/paid`.
- `paymentId`, `receiptUrl`, `paidAt` and `paidById` are never accepted.
- `addedById` is the caller.
- Response `201`: `{ bill }`.

### `PATCH /api/v1/utilities/:id`

Accepts any subset of `category`, `title`, `amount`, `splitType`, `dueDate`,
`notes`. At least one field is required. `dueDate` and `notes` accept `null` to
clear. A bill cannot move between months; delete and recreate if the month is
wrong.

Response `200`: `{ bill }`.

### `PATCH /api/v1/utilities/:id/paid`

```json
{ "isPaid": true }
```

- `true` sets `isPaid`, `paidAt = now`, `paidById = caller`.
- `false` clears `paidAt` and `paidById` so the DB CHECK constraint holds.
- Response `200`: `{ bill }`.

### `DELETE /api/v1/utilities/:id`

Scoped by mess; `CLOSED` month → `409`.
Response `200`: `{ id, deleted: true }`.

## Utility Fund Deposits

`GET` is available to every `ACTIVE` member. `POST`, `PATCH` and `DELETE` are
manager-only (D5).

### `GET /api/v1/utilities/fund-deposits?month=`

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "month": { "...": "same month context" },
    "deposits": [
      {
        "id": "uuid",
        "memberId": "uuid",
        "memberName": "Masad",
        "memberStatus": "ACTIVE",
        "amount": 1000,
        "date": "2026-10-23",
        "note": "October utility advance",
        "receivedById": "uuid",
        "receivedByName": "Manager",
        "createdAt": "2026-10-23T10:00:00.000Z",
        "updatedAt": "2026-10-23T10:00:00.000Z"
      }
    ],
    "total": 1000,
    "byMember": [
      {
        "memberId": "uuid",
        "name": "Masad",
        "status": "ACTIVE",
        "count": 1,
        "amount": 1000
      }
    ]
  }
}
```

Multiple deposits per member and month are allowed (multiple collection rounds).

### `POST /api/v1/utilities/fund-deposits`

Manager only.

```json
{
  "memberId": "uuid",
  "amount": 1000,
  "date": "2026-10-23",
  "note": "October utility advance"
}
```

- `date` is optional and defaults to today in UTC; the month is derived from it.
- `memberId` must be an `ACTIVE` member of the caller's mess.
- `receivedById` is the caller and is never accepted from the body.
- Response `201`: `{ deposit }`.

### `PATCH /api/v1/utilities/fund-deposits/:id`

Manager only. Accepts any subset of `memberId`, `amount`, `date`, `note`.
Changing `date` may move the deposit to another month; both months must be
writable. `receivedById` never changes. Response `200`: `{ deposit }`.

### `DELETE /api/v1/utilities/fund-deposits/:id`

Manager only. Scoped by mess; `CLOSED` month → `409`.
Response `200`: `{ id, deleted: true }`.

## Utility Fund

Any `ACTIVE` member can read the fund summary. Replenishment estimation is
manager-only because it is used when deciding the next collection round.

### `GET /api/v1/utilities/fund?month=`

`month` is optional and defaults to the current UTC month. GET never creates a
month row; a month with no row returns zeros.

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Utility fund fetched successfully",
  "data": {
    "month": { "...": "same month context" },
    "totalDeposits": 4000,
    "totalPaidBills": 2500,
    "balance": 1500,
    "needsReplenishment": false
  }
}
```

- `totalDeposits` is the sum of all deposits in the month, including deposits
  from members who later left.
- `totalPaidBills` is the sum of utility bills where `isPaid = true`. Unpaid
  bills are not deducted.
- `balance = round2(totalDeposits - totalPaidBills)`.
- A negative balance is valid.
- `needsReplenishment` is `true` when `balance <= 0`, including an empty month
  where the balance is `0` (AC 5.2.3).
- Utility fund data never affects the meal rate, meal balances, or settlement.

### `GET /api/v1/utilities/replenishment-estimate?perMember=500`

Manager only.

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

- `perMember` is required, must be greater than `0`, and may have at most two
  decimal places.
- Only members with `status = ACTIVE` are counted.
- `totalExpected = round2(perMember × activeMemberCount)`; zero active members
  returns `0`.
- This endpoint does not subtract the current fund balance. It returns the total
  expected collection for the given per-member amount.

## Summary

Any `ACTIVE` member can read the monthly meal summary. This endpoint uses only
`meal_entry` and `meal_expense`; utility bills and fund deposits are never
included (AC 6.1.5).

### `GET /api/v1/summary?month=YYYY-MM`

`month` is optional and defaults to the current UTC month. A month with no
`mess_month` row returns `200` with `month.exists = false`, zero totals, and the
current ACTIVE members at zero; GET never creates a month. CLOSED months return
the snapshot written when the month was closed, not a live recalculation.

Included members:

- every `ACTIVE` member, even with no meals or bazar
- every non-active member who has meal or bazar data in the month (normally a
  `LEFT` member), so their balance is preserved and the settlement still sums
  to zero
- `LEFT` members with no data are excluded

`guestMeals` count toward the member's total and the house total. Bazar Paid is
the sum of trips where the member is the `shopperId` (not `addedById`).

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Summary fetched successfully",
  "data": {
    "month": {
      "id": "uuid",
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
        "memberId": "uuid",
        "name": "Masad",
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
        "fromMemberId": "uuid",
        "toMemberId": "uuid",
        "amount": 2000
      }
    ],
    "isLocked": false
  }
}
```

Rules:

- `mealRate = totalBazar / totalMeals`, or `0` when `totalMeals = 0`.
- `mealBalance = bazarPaid - mealCost`.
- `balanceStatus` is `RECEIVER` when the balance is positive, `GIVER` when it
  is negative, and `SETTLED` at zero.
- Money values are rounded to 2 decimals only at the response boundary. Member
  costs and balances are reconciled to paise so
  `bazarPaid - mealCost = mealBalance` is exact and the settlement balances
  exactly.
- Do not recompute `mealCost` from the rounded `mealRate`; use the returned
  `mealCost`.
- `settlement` is ordered deterministically: largest debt first, largest credit
  first, with member order as the tie-break.
- The sum of all `settlement[].amount` equals `totals.totalPositiveBalance`, and
  applying the transfers settles every member balance to zero.
- If meals are `0` but bazar is positive, the formula produces only positive
  balances and there is no giver. The response keeps those balances, returns
  `canSettle: false` and an empty settlement list; it does not invent a payer.
- `isLocked` is `false` for `ACTIVE` (or missing) months and `true` for a
  `CLOSED` month.
- When a month is `CLOSED`, the response is the snapshot written by
  `PATCH /api/v1/months/:id/close`: same shape, `month.status = "CLOSED"`,
  `isLocked: true`. Edits to the underlying tables cannot change this response
  until the manager reopens the month. If a legacy closed month has no valid
  snapshot, the server falls back to a live calculation but still returns
  `isLocked: true`.
- A member who joins after a month was closed is not added retroactively to the
  locked member table. The Dashboard returns a zero `meal.me` row for that
  caller rather than failing.

### `GET /api/v1/summary/export?month=YYYY-MM&format=csv|json`

Any `ACTIVE` member. `month` defaults to the current UTC month and `format`
defaults to `csv`. This endpoint never creates a month row and uses the same
Summary service as `GET /api/v1/summary`, so a closed month exports the locked
snapshot. Utility bills and fund deposits are never included.

`format=json` returns the standard API envelope with `data` exactly matching the
Summary response.

`format=csv` returns a downloadable UTF-8 file:

- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="mess-tally-summary-2026-10.csv"`
- leading UTF-8 BOM (so Excel reads Bangla names correctly)
- CRLF line endings and RFC 4180 escaping

The file contains the summary totals, a member table and the settlement list:

```csv
Month,2026-10
Status,CLOSED
Locked,true
Can Settle,true
Total Meals,30.00
Total Bazar,3000.00
Meal Rate,100.00
Total Positive Balance,2000.00

Member ID,Name,Status,Total Meals,Meal Cost,Bazar Paid,Meal Balance,Balance Status
uuid,Masad,ACTIVE,10.00,1000.00,3000.00,2000.00,RECEIVER

Settlement
From Member ID,From Name,To Member ID,To Name,Amount
uuid,Masad,uuid,Rahim,2000.00
```

Invalid `format` returns `400`.

## Dashboard

Any `ACTIVE` member can read the Dashboard. It combines the meal block from
the Summary service and the utility fund block from the Utility Fund service,
so the numbers always match their dedicated pages. Utility data stays in its
own block and never enters the meal math.

### `GET /api/v1/dashboard?month=YYYY-MM`

`month` is optional and defaults to the current UTC month. GET never creates a
month row. CLOSED months remain readable; the meal block uses the locked Summary
snapshot. If the caller joined after the month was closed, `meal.me` is a zero
row because they were not part of that finalized month.

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Dashboard fetched successfully",
  "data": {
    "month": { "...": "same month context" },
    "meal": {
      "totalMeals": 30,
      "totalBazar": 3000,
      "mealRate": 100,
      "me": {
        "memberId": "uuid",
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

- `meal` is exactly the `totals` and caller's member row from
  `GET /api/v1/summary`.
- `utility` is exactly the fund summary from
  `GET /api/v1/utilities/fund`.
- `pendingMemberCount` is the number of `PENDING` members for managers and
  `null` for non-managers.
- No settlement list is returned; the Summary page remains the detailed view.
- A month with no row returns active members' zero meal values and zero fund
  values without creating a row.

## Status code summary

| Code | Meaning |
|---|---|
| `400` | Bad month/date/amount, negative meals, `CUSTOM_WEIGHT`, empty PATCH, bad filters |
| `401` | Missing/invalid token |
| `403` | No active membership, non-manager opening a month or writing deposits |
| `404` | Month/member/meal/bazar/bill/deposit not found in the caller's mess |
| `409` | Closed month, locked meal entry, non-active member, already-closed month |

## Shared month helpers

```ts
import {
  getOrCreateMonthByDate,
  getMonthByDate,
  assertMonthWritable,
  resolveMonthForRead,
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
