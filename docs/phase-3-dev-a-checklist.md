# Phase 3 Dev A — Manual Acceptance Checklist

Run these in the Postman **Summary** folder after Login (or Verify Email) with
an active mess. Set up at least three members with meals and bazar in the
selected month. Tokens remain identity-only; no `messId` is read from the JWT.

## Formula and response

- [ ] `GET /api/v1/summary?month=2026-10` → `200`, `{ month, canSettle, totals, members, settlement }`.
- [ ] `totals.totalMeals` equals the sum of all included members' meal totals, including `guestMeals`.
- [ ] `totals.totalBazar` equals the sum of all included members' `bazarPaid`.
- [ ] `mealRate = round2(totalBazar / totalMeals)`, or `0` when `totalMeals = 0`.
- [ ] Every member has `bazarPaid - mealCost = mealBalance` at 2 decimals.
- [ ] `balanceStatus` is `RECEIVER` for positive, `GIVER` for negative, `SETTLED` for zero.
- [ ] Bazar Paid uses `shopperId`, not `addedById`.
- [ ] `settlement` contains only `{ fromMemberId, toMemberId, amount }`.
- [ ] Summing `settlement[].amount` equals `totals.totalPositiveBalance`.
- [ ] Applying every transfer to the member balances leaves every balance at `0`.

## Member inclusion

- [ ] An ACTIVE member with no meals and no bazar appears with zeros and `SETTLED`.
- [ ] A LEFT member with meals or bazar this month appears with `status: "LEFT"` and their balance.
- [ ] A LEFT member with no data this month does not appear.
- [ ] A member who joined mid-month appears if ACTIVE now.
- [ ] `guestMeals` increase both the member total and the house total.

## Edge cases

- [ ] A month with no `mess_month` row → `200`, `month.exists = false`, zero totals, no month row created.
- [ ] Zero meals and zero bazar → `mealRate = 0`, `canSettle = true`, empty settlement.
- [ ] Zero bazar with meals → `mealRate = 0`, all costs and balances zero.
- [ ] One member with meals and bazar → balance zero, no transfers.
- [ ] Positive bazar with zero meals → `canSettle = false`, empty settlement, positive balances preserved.
- [ ] `100 / 3` odd-cent data settles to exactly 2 decimals; the transfer total matches `totalPositiveBalance`.
- [ ] A CLOSED month remains readable.
- [ ] `GET /api/v1/summary?month=2026-13` → `400`.
- [ ] No token → `401`; no active membership → `403`.

## Independence and guards

- [ ] Create or change a utility bill → summary totals, balances and settlement are unchanged.
- [ ] Create or change a fund deposit → summary totals, balances and settlement are unchanged.
- [ ] Confirm the summary module does not query `utility_expense` or `deposit`.
- [ ] Run `npx tsc --noEmit` and Biome on the summary module.
