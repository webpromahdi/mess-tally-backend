# Phase 2 Dev A — Manual Acceptance Checklist

Run these in the Postman collection folders **Months** and **Meals** after Login
(or Verify Email) as a manager with an active mess. Tokens are identity-only;
confirm the access token payload is `{ userId, name, email, role }` and contains
no `messId`.

## Months

- [ ] `GET /api/v1/months` → `200`, `{ months, total }`, newest first, `isCurrent` on this month.
- [ ] Login as a plain member, `POST /api/v1/months` → `403` "Manager access is required".
- [ ] As manager, `POST /api/v1/months` with `{ "month": "2026-10" }` → `201`, `created: true`, `month.name = "2026-10"`, `startDate = 2026-10-01`, `endDate = 2026-10-31`.
- [ ] Repeat the same `POST` → `200`, `created: false`.
- [ ] `POST` with `2026-13`, `2026-1`, or `not-a-month` → `400`.
- [ ] Set a month's `status` to `CLOSED` directly in the DB, then `POST /api/v1/months` for it → `409`.

## Meals — read

- [ ] `GET /api/v1/meals?month=2026-10` → `200`.
- [ ] `days` contains every day of October (31 entries).
- [ ] Every ACTIVE member appears once, with one cell per day and zero-filled gaps.
- [ ] `houseTotals` equals the sum of member totals.
- [ ] `GET` for a month with no `mess_month` row → `200`, `month.exists = false`, `month.id = null`, and no row was created in `mess_month`.
- [ ] `GET /api/v1/meals?month=2026-13` → `400`.
- [ ] A LEFT member who has entries this month appears with `status: "LEFT"`.

## Meals — single upsert

- [ ] `PUT /api/v1/meals` with a valid ACTIVE member and `2026-10-03` → `200`, `{ entry }`, `total` equals b+l+d+g.
- [ ] Repeat the exact same payload → `200` and the grid still has one row for that cell (idempotent).
- [ ] `GET` the month again → the cell has an `entryId` and the member/house totals increased.
- [ ] `breakfast: -1` → `400` "Meal counts cannot be negative."
- [ ] `lunch: "abc"`, `null`, or missing → `400`.
- [ ] `date: "2026-02-30"` → `400`.
- [ ] `date: "2026-09-30"` → `200`; `GET /api/v1/months` now contains `2026-09`.
- [ ] Use a member id from another mess → `404`.
- [ ] Use a `PENDING` or `LEFT` member id → `409`.
- [ ] Mark the entry `isLocked = true` in the DB, then `PUT` it → `409`.
- [ ] Set its month to `CLOSED`, then `PUT` → `409`.

## Meals — bulk

- [ ] `POST /api/v1/meals/bulk` with two members and one date → `200`, `{ entries }` has two rows.
- [ ] Repeat → `200`, no duplicate rows.
- [ ] Duplicate the same `memberId` twice in `entries` → `400`.
- [ ] Put one cross-mess member in an otherwise valid batch → `404` and **no** rows were written (check the grid).
- [ ] Put one locked member in the batch → `409` and no rows were written.
- [ ] Empty `entries` or more than 200 → `400`.

## Meals — delete

- [ ] `DELETE /api/v1/meals/:id` for an existing entry → `200`, `{ id, deleted: true }`.
- [ ] Repeat the same delete → `404`.
- [ ] Delete a cross-mess entry id → `404`.
- [ ] Delete an entry in a `CLOSED` month or with `isLocked = true` → `409`.

## Guards

- [ ] Any endpoint without a token → `401`.
- [ ] A user with no active mess → `403`.
- [ ] A user whose `activeMessId` points at a mess where their membership is not `ACTIVE` → `403`.
- [ ] Body fields `messId`, `updatedById`, or `createdById` are ignored (never required).
