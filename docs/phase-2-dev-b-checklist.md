# Phase 2 Dev B — Manual Acceptance Checklist

Run these in the Postman folders **Bazar**, **Utilities** and **Fund Deposits**
after Login (or Verify Email). Start with a manager account that has an active
mess and an ACTIVE second member.

Setup:

1. `GET /api/v1/months` and `GET /api/v1/meals?month=2026-10` so `{{month}}` and
   `{{memberId}}` are populated.
2. Set the collection variable `entryDate` to a date in the selected month.
3. Confirm the access token payload is `{ userId, name, email, role }` and has
   no `messId` claim.

## Bazar

- [ ] `POST /api/v1/bazar` with title, items, amount, `bazarDate`, `shopperId` → `201`, `entry.title` set, `entry.paidFromMessFund = false`, `addedById` = caller.
- [ ] Repeat without `title` → `201`, `entry.title = "Bazar"`.
- [ ] `GET /api/v1/bazar?month=2026-10` → `200`, entries ordered by `bazarDate` then `createdAt`.
- [ ] `totals.houseTotal` equals the sum of `entry.amount`; `totals.byShopper` groups by shopper with correct `count` and `amount`.
- [ ] `GET` with `from`/`to` inside the month → only rows in that inclusive range.
- [ ] `GET` with `from` before the month or `to` after the month → `400`.
- [ ] `GET` with `from` after `to` → `400`.
- [ ] `GET` a month with no `mess_month` row → `200`, `month.exists = false`, `month.id = null`, zero totals, and no row created in `mess_month`.
- [ ] `PATCH /api/v1/bazar/:id` with only `amount` → `200`; other fields unchanged.
- [ ] `PATCH` with no editable field → `400`.
- [ ] `amount: 1.999` → `400` (more than 2 decimals).
- [ ] `amount: 0` or a negative amount → `400`.
- [ ] `bazarDate: "2026-02-30"` → `400`.
- [ ] `shopperId` from another mess → `404`.
- [ ] `shopperId` of a `PENDING`/`LEFT` member in this mess → `409`.
- [ ] `bazarDate` in another month → the entry appears in that month's list and its `messMonthId` changed.
- [ ] Move an entry out of a `CLOSED` source month → `409`.
- [ ] Move an entry into a `CLOSED` target month → `409`.
- [ ] Edit an entry in a `CLOSED` month → `409`.
- [ ] `DELETE` an entry → `200`, `{ id, deleted: true }`; repeat → `404`.
- [ ] `DELETE` a cross-mess entry id → `404`.
- [ ] Confirm meals, meal rate and totals do not change after bazar writes.

## Utilities

- [ ] `POST /api/v1/utilities` with `month`, category, title, amount → `201`, `isPaid = false`, `paidAt = null`, `paidById = null`, `addedById` = caller.
- [ ] Omit `category` → defaults to `OTHER`.
- [ ] Omit `splitType` → defaults to `EQUAL`.
- [ ] `splitType: "CUSTOM_WEIGHT"` → `400`.
- [ ] `GET /api/v1/utilities?month=2026-10` → `200`, bills plus totals.
- [ ] `totals.total` equals the sum of bills; `paid`/`unpaid` split on `isPaid`.
- [ ] `activeMemberCount` counts only ACTIVE members.
- [ ] `perPersonShare` equals `round2(total / activeMemberCount)` and is `0` when the count is zero.
- [ ] `GET` a month with no row → `200`, `month.exists = false`, zero totals, and no row created.
- [ ] `PATCH /api/v1/utilities/:id` with only `title` → `200`; amount and payment state unchanged.
- [ ] `PATCH` with `dueDate: null` or `notes: null` → field cleared.
- [ ] `PATCH` with no editable field → `400`.
- [ ] `PATCH` with `isPaid` only → `400` (use `/:id/paid`).
- [ ] `PATCH /api/v1/utilities/:id/paid` with `{ "isPaid": true }` → `isPaid = true`, `paidAt` set, `paidById` = caller.
- [ ] Repeat with `{ "isPaid": false }` → `isPaid = false`, `paidAt` and `paidById` cleared.
- [ ] Create/edit/delete in a `CLOSED` month → `409`.
- [ ] Cross-mess bill id → `404`.
- [ ] `DELETE` a bill → `200`; repeat → `404`.
- [ ] Confirm meals, bazar, meal rate and settlement do not change after utility writes.

## Fund Deposits

- [ ] As manager, `POST /api/v1/utilities/fund-deposits` with member, amount, date, note → `201`, `receivedById` = caller.
- [ ] Omit `date` → uses today in UTC and the current month.
- [ ] `GET /api/v1/utilities/fund-deposits?month=2026-10` as a plain member → `200`.
- [ ] `total` equals the sum of deposits; `byMember` groups by member with correct `count` and `amount`.
- [ ] Add two deposits for the same member in one month → both appear and are summed.
- [ ] As a plain member, `POST`/`PATCH`/`DELETE` → `403`.
- [ ] `memberId` from another mess → `404`.
- [ ] `memberId` of a `PENDING`/`LEFT` member → `409`.
- [ ] `amount: 1.999` → `400`; `amount: 0` → `400`.
- [ ] `date: "2026-02-30"` → `400`.
- [ ] `PATCH` with only `amount` or `note` → `200`; `receivedById` unchanged.
- [ ] `PATCH` with no editable field → `400`.
- [ ] Change `date` to another month → the deposit moves to that month; both months must be ACTIVE.
- [ ] Write in a `CLOSED` month → `409`.
- [ ] `DELETE` a deposit → `200`; repeat → `404`.
- [ ] Confirm deposits do not modify utility totals or meal numbers.

## Guards

- [ ] Any route without a token → `401`.
- [ ] A user with no active mess → `403`.
- [ ] A user whose `activeMessId` points at a mess where their membership is not `ACTIVE` → `403`.
- [ ] Sending `messId`, `addedById`, `receivedById`, `paidById`, `paidFromMessFund` or `paidAt` in a body is ignored; the server uses the caller and defaults.
