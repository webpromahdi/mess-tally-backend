# Phase 3 Dev B — Manual Acceptance Checklist

Run these in the Postman folders **Utilities**, **Dashboard** and **Summary**
after Login (or Verify Email) with an active mess. Utility fund math is
independent of meal math; verify both sides explicitly.

## Utility fund

- [ ] `GET /api/v1/utilities/fund?month=2026-10` → `200`, `{ month, totalDeposits, totalPaidBills, balance, needsReplenishment }`.
- [ ] Record a deposit of `1000` → `totalDeposits` increases by `1000`.
- [ ] Create a bill of `400` and leave it unpaid → `totalPaidBills` and `balance` do not change.
- [ ] Mark that bill paid → `totalPaidBills` increases by `400` and `balance` drops by `400`.
- [ ] With deposits `1000` and paid bills `400` → `balance = 600`, `needsReplenishment = false`.
- [ ] Make paid bills exceed deposits → balance is negative, `needsReplenishment = true`.
- [ ] With deposits equal to paid bills → `balance = 0`, `needsReplenishment = true`.
- [ ] A month with no row → `month.exists = false`, zero totals, `needsReplenishment = true`, and no month row created.
- [ ] Deposits from a LEFT member still count toward `totalDeposits`.
- [ ] Unpaid bills are excluded from `totalPaidBills`.

## Replenishment estimate

- [ ] As a manager, `GET /api/v1/utilities/replenishment-estimate?perMember=500` → `200`, `{ perMember, activeMemberCount, totalExpected }`.
- [ ] `totalExpected = round2(perMember × activeMemberCount)`.
- [ ] With zero ACTIVE members → `totalExpected = 0`.
- [ ] As a plain member → `403` "Manager access is required".
- [ ] Missing `perMember`, `0`, negative, non-numeric or more than 2 decimals → `400`.
- [ ] The estimate does not subtract the current fund balance.

## Dashboard

- [ ] `GET /api/v1/dashboard?month=2026-10` → `200`, `{ month, meal, utility, pendingMemberCount }`.
- [ ] `meal.totalMeals`, `meal.totalBazar` and `meal.mealRate` exactly match `GET /api/v1/summary`.
- [ ] `meal.me` matches the caller's row in the Summary response.
- [ ] `utility` exactly matches `GET /api/v1/utilities/fund`.
- [ ] As a manager, `pendingMemberCount` equals the PENDING member count.
- [ ] As a plain member, `pendingMemberCount` is `null`.
- [ ] A month with no row returns zero meal/fund values and `month.exists = false` without creating a month.
- [ ] `guestMeals` are included in `meal.me.totalMeals` and house totals.
- [ ] No settlement list is returned; the Summary page remains the detailed view.

## Independence and isolation

- [ ] Change a utility bill and re-read Summary → meal rate, balances and settlement are unchanged.
- [ ] Change a fund deposit and re-read Summary → meal rate, balances and settlement are unchanged.
- [ ] Change meals/bazar and re-read Utility Fund → fund values are unchanged.
- [ ] Cross-mess access is impossible; no active membership → `403`.
- [ ] No token → `401`.
- [ ] `GET /api/v1/dashboard?month=2026-13` → `400`.
- [ ] A CLOSED month remains readable.
- [ ] Run `npx tsc --noEmit`, `npm run build`, and Biome on the utility/dashboard modules.
