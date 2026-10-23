# Phase 4 Dev A — Manual Acceptance Checklist

Run these in the Postman **Months** and **Summary** folders after Login (or
Verify Email) with an active mess. Use a month with at least two ACTIVE members,
meals, bazar, a paid utility bill, an unpaid utility bill and a fund deposit.

## Close month

- [ ] As a manager, `PATCH /api/v1/months/{{monthId}}/close` → `200`, `{ month }`, `status: "CLOSED"`, `closedAt` set.
- [ ] `GET /api/v1/months` shows the same month as `CLOSED`.
- [ ] A second close → `409` "already closed".
- [ ] A plain member → `403` "Manager access is required".
- [ ] A month id from another mess → `404`.
- [ ] A non-existent id → `404`.
- [ ] In the database, `locked_meal_rate`, `locked_total_meals`, `locked_total_bazar` and `locked_total_utilities` match the last Summary/utility figures.
- [ ] `locked_total_utilities` includes both paid and unpaid bills.
- [ ] `locked_snapshot` has `version: 1`, `closedAt`, `summary`, settlement and `utility`.
- [ ] Every `meal_entry.is_locked` row in the month is `true`.

## Locked summary

- [ ] `GET /api/v1/summary?month=YYYY-MM` → `200`, `isLocked: true`, `month.status: "CLOSED"`.
- [ ] Totals, member rows and settlement exactly match the pre-close response.
- [ ] Directly change a meal/bazar row in the database, then re-read Summary → the locked values are unchanged.
- [ ] A member who joins after close sees zero `meal.me` on `GET /api/v1/dashboard?month=YYYY-MM`; the Dashboard does not return `500`.
- [ ] Summary still excludes utility values (AC 6.1.5).

## Writes blocked

Every write to the closed month must return `409`:

- [ ] Meal upsert, bulk upsert and delete.
- [ ] Bazar create, update and delete.
- [ ] Utility create, update, mark paid/unpaid and delete.
- [ ] Deposit create, update and delete.

## Reopen month

- [ ] As a manager, `PATCH /api/v1/months/{{monthId}}/reopen` → `200`, `{ month }`, `status: "ACTIVE"`, `closedAt: null`.
- [ ] `closedAt`, `closedById`, all `locked_*` fields and `locked_snapshot` are cleared.
- [ ] Every meal entry in the month has `is_locked = false`.
- [ ] `GET /api/v1/summary` is live again with `isLocked: false`.
- [ ] A second reopen → `409` "already active".
- [ ] A plain member → `403`.
- [ ] A meal/bazar/utility/deposit write succeeds again.
- [ ] Closing the month again creates a fresh snapshot.

## Export

- [ ] `GET /api/v1/summary/export?month=YYYY-MM&format=csv` → `200`, `text/csv; charset=utf-8`, attachment filename.
- [ ] The response begins with a UTF-8 BOM (`\uFEFF`).
- [ ] The CSV contains summary totals, the member table and the settlement list.
- [ ] Bengali names, commas and quotes are escaped correctly.
- [ ] The CSV contains no utility values.
- [ ] A CLOSED month exports the locked snapshot, not live data.
- [ ] `GET /api/v1/summary/export?month=YYYY-MM&format=json` → `200`, standard envelope; `data` exactly matches `GET /api/v1/summary`.
- [ ] Omit `format` → CSV is returned.
- [ ] `format=xlsx` → `400`.
- [ ] A month with no row exports zero totals and does not create a month row.
- [ ] No token → `401`; no active membership → `403`.

## Final checks

- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run build` passes.
- [ ] Biome passes on the changed modules.
- [ ] `Mess_Tally.postman_collection.json` is valid JSON and includes Close Month, Reopen Month, Export Summary CSV and Export Summary JSON.
- [ ] Temporary smoke data is removed.
