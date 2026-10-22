# MessTally - Backend Plan

**Stack:** Express.js + TypeScript, Prisma + PostgreSQL, Passport JWT, Zod, Biome, Vercel
**Team:** Dev A and Dev B (backend), Frontend 1 and Frontend 2 (frontend)
**Source:** `prd.md`
**Status:** Auth (login, JWT, `checkAuth`) is DONE.

> Replace "Dev A" and "Dev B" with real names.

---

## 1. Principles

1. **Contract first.** Every endpoint is agreed (path, request, response, errors) before it is built. Frontend mocks against the contract while we build.
2. **Vertical slices.** One dev owns a module end to end: route, validation, service, Prisma, tests.
3. **Pure logic stays pure.** Calculator, settlement, utility share and simulation are pure functions with unit tests. The AI tools reuse them, so numbers always match the Dashboard.
4. **Every query is mess-scoped.** The JWT is identity-only; each mess-scoped service resolves the caller's active mess from `user.activeMessId` and verifies the matching `mess_member` row is `ACTIVE`.
5. **Meal and utility accounting never mix** (PRD 1.5 #2).
6. **Cross-review.** Dev A reviews Dev B's PRs and the other way around. No self-merge.

---

## 2. Dependency Flow

```
Phase 0  Foundation (shared contracts, schema, guards)
   |
Phase 1  Mess + Members  (gate for everything: active mess resolves from user.activeMessId)
   |
Phase 2  Months + Meals (A)  ||  Bazar + Utilities + Fund (B)
   |
Phase 3  Summary Engine (A)  ||  Dashboard + Utility Fund math (B)
   |
Phase 4  Close Month + Export (A)  ||  Aggregations + Indexes (B)
   |
Phase 5  AI: Provider + Chat Loop (A)  ||  AI Tools + Guardrails (B)
   |
Phase 6  Hardening, Docs, Deploy (both)
```

`||` means the two devs work in parallel. The line between phases is a **sync point** (30 min call, merge to `develop`, tell frontend what is ready).

---

## 3. Ownership Summary

| Phase | Dev A | Dev B | Est. |
|---|---|---|---|
| 0 Foundation | Prisma schema, migrations, seed | Guards, shared utils, API contract doc | 1-2 d |
| 1 Mess + Members | Mess create/join, active-mess pointer | Members list, approve/reject, leave, settings | 3-4 d |
| 2 Inputs | Months + Meals | Bazar + Utilities + Deposits | 4-5 d |
| 3 Calculations | Summary calculator + settlement | Utility share/fund + Dashboard | 3-4 d |
| 4 Finalize | Close month + locking + export | Aggregation tuning, indexes, edge cases | 2-3 d |
| 5 AI | LLM adapters + chat orchestration | Tool registry + propose tools + guardrails | 4-5 d |
| 6 Hardening | Integration tests, deploy | Docs, rate limit, QA with frontend | 3 d |

Rough total: 20-26 working days for two devs. Adjust after Phase 1 once real velocity is known.

---

## 4. Decisions Needed Before Phase 2 (PRD gaps)

Defaults are proposed so we are not blocked. Confirm or change in the Phase 0 call.

| # | Question | Proposed default |
|---|---|---|
| D1 | A meal or bazar date falls in a month with no `mess_month` row. Reject or auto-create? | Auto-create a `mess_month` for that calendar month (status ACTIVE). Manager "open month" still exists for explicit control. |
| D2 | Can records in a `CLOSED` month be edited? PRD says edits allowed while ACTIVE, but also says past-month entries are accepted. | Block writes to CLOSED months with 409. Manager can reopen (`PATCH /api/months/:id/reopen`). |
| D3 | Who can write meals and bazar? | Any ACTIVE member. |
| D4 | Who can write utility bills? | Any ACTIVE member (PRD story 5.1). |
| D5 | Who can record deposits, open/close months, approve members? | `is_manager = true` only. |
| D6 | PRD uses legacy `paidByProfileId` and `profileId`. Schema uses `shopper_id` and `member_id`. | API uses `shopperId` and `memberId` (mess_member ids). Frontend is told once. |
| D7 | How does a request know which mess it is for? | The JWT stays identity-only. `POST /api/mess`, `/join` and `/approve` write `user.activeMessId`; mess-scoped services resolve it and verify the `mess_member` row is `ACTIVE`. There is no switch endpoint and no `messId` claim. |
| D8 | Who is allowed to remove a manager or transfer ownership? | The current manager transfers `is_manager` to another ACTIVE member and gives it up in the same transaction (one manager per mess). `role = OWNER` is unchanged by that transfer, and the owner can call it even when not currently the manager. Ownership itself moves with `PATCH /api/mess/members/:id/owner` (OWNER only): the target becomes `OWNER` + manager and the previous owner becomes a `MEMBER`. An owner with other ACTIVE members must transfer ownership before leaving. |
| D9 | Rounding. | Compute in full precision, round to 2 decimals at the response layer. Settlement uses a 0.01 tolerance and puts leftover cents on the last transfer. |
| D10 | A user who LEFT or was REJECTED tries to join again. `(user_id, mess_id)` is unique, so a second row is impossible. | Reuse the same row: set status back to PENDING (or ACTIVE if no approval needed), clear `left_at`. Return 409 only for PENDING or ACTIVE. |
| D11 | `meal_expense.paid_from_mess_fund` default was TRUE, but meal formula 5 credits the shopper's own money. | Default FALSE. The calculator ignores this flag this phase (there is no meal fund). |
| D12 | Deleting a member with data. The old SQL cascaded `meal_entry` on member delete. | `meal_entry.member` is RESTRICT, same as bazar and deposits (AC 2.1.3). Use `status = LEFT`. |
| D13 | Where is the active mess stored? | On the user row: `User.activeMessId` (nullable FK to `mess`, `onDelete: SetNull`). It is a pointer, always verified against an `ACTIVE` membership before use. |
| D14 | Can a user be ACTIVE in more than one mess? | No. One active mess per user; joining while active elsewhere returns 409. The pointer makes that single active mess explicit. |

---

## 5. Phase 0 - Foundation (1-2 days)

Goal: shared base so nobody blocks anybody.

### Dev A
- [ ] Adopt the multi-file Prisma schema in `prisma/schema/` (one file per model: `user`, `profile`, `mess`, `mess-member`, `mess-month`, `meal-entry`, `meal-expense`, `utility-expense`, `deposit`, plus `mess-enums` and `base`). Set `"prisma": { "schema": "prisma/schema" }` in `package.json`.
- [ ] Mess enums are `MessRole`, `MemberStatus`, `MessPlan`, `MonthStatus`, `UtilityCategory`, `UtilitySplitType`. The existing `Role` and `Status` enums on `User` are not touched.
- [ ] Uncomment and use the `User.memberships` relation. Run `prisma validate`, then `migrate dev`.
- [ ] Apply the CHECK constraints and one-OWNER index as a custom migration (`prisma/migrations/*_db_constraints/migration.sql`), since Prisma's schema language cannot express them.
- [ ] Write `seed.ts`: 1 mess, 5 members (1 owner-manager, 1 pending, 3 active), 1 active month, ~20 meal rows, 5 bazar rows, 4 bills, 3 deposits.
- [ ] Add a reset script (`db:reset`). Mess deletion is not a feature this phase, so reset deletes in dependency order or truncates with CASCADE.

### Dev B
- [ ] Confirm shared utilities exist: `validateRequest`, `apiResponse`, `AppError`, global error handler, `date.util.ts`.
- [ ] Auth and scope helpers:
  - `checkAuth` (exists) - identity only, no mess scope
  - `mess.scope.ts` service helper - `requireActiveMembership(userId)` reads `user.activeMessId`, verifies the `mess_member` row is `ACTIVE`, returns the member + mess
  - `assertManager(member)` / `assertOwner(member)` in the same helper
- [ ] `month.util.ts`: `parseMonthParam("YYYY-MM")`, `monthRangeFromDate(date)`, UTC safe.
- [ ] Write `docs/api-contract.md` (or OpenAPI) with all endpoints from section 12. Share with frontend.
- [ ] Standard pagination and error code list (400, 401, 403, 404, 409).

### Done when
- Migration runs clean, seed runs, scope helpers unit-tested, contract doc shared.

---

## 6. Phase 1 - Mess and Members (3-4 days)

PRD modules 1.5 and 2. Everything else depends on an active mess, so this goes first.

### Dev A - Mess lifecycle
- [ ] `POST /api/mess` - create mess, generate a unique `room_code` from the `mess_room_code_seq` sequence + sqids, create OWNER + `is_manager` + ACTIVE member and set `user.activeMessId` in one transaction, return 201 with the mess (AC 1.5.1.x).
- [ ] `POST /api/mess/join` - find by `room_code` (404), reject if `is_joinable = false` (403), reject duplicate PENDING/ACTIVE (409), PENDING or ACTIVE depending on `require_approval`; set `user.activeMessId` when ACTIVE; LEFT or REJECTED users reuse their row (D10) (AC 1.5.2.x).
- [ ] Tokens stay identity-only (`{ userId, name, email, role }`). Login and refresh return `activeMessId` (+ mess summary) read from the user row.
- [x] `GET /api/mess/my` - list the user's messes with role and status (for the mess picker). Response: `{ activeMessId, messes[] }`, `ACTIVE`/`PENDING`/`LEFT` only, `isActive` marks the verified pointer.
- [ ] No switch endpoint; switching means leaving the current mess and joining another.
- [ ] Tests: create, join variants, active pointer set/clear, login with 0/1 active mess.

### Dev B - Members and settings
- [x] `GET /api/mess/members` - all members for active mess (id, name, role, status, is_manager). Optional `?status=ACTIVE` for dropdowns (AC 2.1.1, 2.1.2).
- [x] `GET /api/mess/members/pending` - manager only.
- [x] `PATCH /api/mess/members/:id/approve` and `/reject` - manager only, must be PENDING, scoped to same mess (AC 1.5.3.x).
- [x] `PATCH /api/mess/members/:id/manager` - the current manager transfers the manager position to an ACTIVE member and gives up `is_manager`; `OWNER` keeps the role and only one manager exists per mess.
- [x] `PATCH /api/mess/members/:id/owner` - owner only; the target must be ACTIVE. The target becomes `OWNER` + manager and the previous owner becomes a `MEMBER` without `is_manager`, keeping exactly one owner and one manager.
- [x] `POST /api/mess/leave` - sets `LEFT` + `left_at`. An owner with other ACTIVE members must transfer ownership first; the last active member can always leave.
- [x] `DELETE /api/mess/members/:id` - blocked with clear error if meals or bazar exist; suggest `LEFT` (AC 2.1.3).
- [ ] `GET /api/mess` and `PATCH /api/mess` - view and update name, address, currency, `is_joinable`, `require_approval` (owner or manager).
- [ ] Tests: permission matrix (owner, manager, member, outsider from another mess).

### Sync point 1
Frontend can build: mess create/join, mess picker, members page, approval screen.

---

## 7. Phase 2 - Inputs (4-5 days)

Month container plus the three raw-data modules. A and B work in parallel on separate tables.

### Dev A - Months and Meals

**Months** (`/api/months`)
- [ ] `getOrCreateMonthByDate(messId, date)` service (decision D1). Name format `YYYY-MM`, `start_date`, `end_date` from `date.util`. **Dev B imports this in Bazar and Utilities, so ship it in the first 1-2 days.**
- [ ] `GET /api/months` - list, newest first.
- [ ] `POST /api/months` - manager opens a month explicitly.
- [ ] `assertMonthWritable(month)` helper - throws 409 if CLOSED (decision D2).

**Meals** (`/api/meals`)
- [ ] `GET /api/meals?month=YYYY-MM` - grid data: all ACTIVE members x dates, plus per-member totals and house total (AC 3.1.1).
- [ ] `PUT /api/meals` - upsert one cell `{ memberId, date, breakfast, lunch, dinner, guestMeals }`. Month derived from date (AC 3.1.2, 3.1.5).
- [ ] `POST /api/meals/bulk` - upsert many rows in one transaction (for daily entry).
- [ ] `DELETE /api/meals/:id`.
- [ ] Zod: values >= 0, valid date, member must be ACTIVE and in same mess (AC 3.1.3).
- [ ] Respect `is_locked`.
- [ ] Tests: upsert idempotency, negative values, previous-month date, cross-mess member id.

### Dev B - Bazar, Utilities, Deposits

**Bazar** (`/api/bazar`)
- [ ] `GET /api/bazar?month=&shopperId=&from=&to=` - chronological list, per-shopper totals, house total (AC 4.1.2).
- [ ] `POST`, `PATCH /:id`, `DELETE /:id` - amount > 0, shopper required and ACTIVE (AC 4.1.1, 4.1.4, 4.1.5).
- [ ] `added_by_id` taken from `req.member`, never from body.

**Utilities** (`/api/utilities`)
- [ ] `GET /api/utilities?month=` - bills list, total, per-person share (formula U1, zero-member safe) (AC 5.1.2, 5.1.3).
- [ ] `POST`, `PATCH /:id`, `DELETE /:id` - category enum, `split_type` default `EQUAL`, reject `CUSTOM_WEIGHT` for now (AC 5.1.5).
- [ ] `PATCH /:id/paid` - set `is_paid`, `paid_at`, `paid_by_id`.

**Deposits** (`/api/utilities/fund-deposits`) - manager only
- [ ] `GET` (by month), `POST` (member, amount > 0), `PATCH /:id`, `DELETE /:id` (AC 5.2.1).
- [ ] `received_by_id` from `req.member`.

### Sync point 2
Frontend can build: Meals grid (with optimistic updates), Bazar list/form, Utility bills and deposit forms. Summary and Dashboard still mocked.

---

## 8. Phase 3 - Calculations (3-4 days)

The financial core. Dev A owns meal math, Dev B owns utility math and the dashboard that combines both.

### Dev A - Summary engine (`/api/summary`)
- [ ] `summaryCalculatorService` as **pure functions** (input: arrays of meals and bazar totals, output: numbers). Formulas 1 to 5:
  - total meals (includes `guest_meals`)
  - total bazar
  - meal rate (0 if no meals)
  - meal cost = meals x rate (full precision)
  - meal balance = bazar paid - meal cost
- [ ] `summarySettlementService` as pure function: greedy match giver/receiver, `min(|giver|, receiver)`, loop until all within 0.01. Output list `{ fromMemberId, toMemberId, amount }` (AC 6.1.4).
- [ ] Mark each member as `RECEIVER` / `GIVER` / `SETTLED` (AC 6.1.3).
- [ ] `GET /api/summary?month=YYYY-MM` - thin wrapper that loads data, calls the pure functions, rounds to 2 decimals.
- [ ] Only ACTIVE members count. For a member who LEFT mid-month and has data, include them if they have meals or bazar that month (so balances sum to zero). Document this rule.
- [ ] Unit tests: zero meals, zero bazar, one member, all equal, odd cents (e.g. 100 / 3), many givers and one receiver, sum of transfers equals sum of positive balances within 0.01.
- [ ] **Never import utility data here** (AC 6.1.5).

### Dev B - Utility fund and Dashboard
- [ ] `utilityCalculatorService` as pure functions: share (U1), fund balance (U2), replenishment estimate (U3).
- [ ] `GET /api/utilities/fund?month=` - `{ totalDeposits, totalPaidBills, balance, needsReplenishment }` (AC 5.2.2, 5.2.3).
- [ ] `GET /api/utilities/replenishment-estimate?perMember=` - expected total (U3).
- [ ] `GET /api/dashboard?month=` - combines: meal rate, total meals, total bazar (calls Dev A's calculator), utility fund summary, pending member count (managers), my own meals and balance. Keep meal and utility blocks as separate keys.
- [ ] Tests: AC 5.1.4 (changing a bill does not move the meal rate), fund balance negative, zero members.

### Sync point 3
Frontend can wire real Summary and Dashboard. **Dev A publishes the calculator function signatures here, because Phase 5 reuses them.**

---

## 9. Phase 4 - Finalize Month and Export (2-3 days)

### Dev A
- [ ] `PATCH /api/months/:id/close` - manager only. In one transaction: compute summary and utilities, store `locked_meal_rate`, `locked_total_meals`, `locked_total_bazar`, `locked_total_utilities` and the full `locked_snapshot` (summary + settlement JSON), set `closed_at`, `closed_by_id`, `status = CLOSED`, set `meal_entry.is_locked = true`.
- [ ] `PATCH /api/months/:id/reopen` - manager only, clears locks (decision D2).
- [ ] When a month is CLOSED, `GET /api/summary` returns the locked snapshot plus a flag `isLocked: true`.
- [ ] `GET /api/summary/export?month=&format=csv|json` - member table, settlement list, totals. CSV with UTF-8 BOM so Excel opens Bangla names correctly.
- [ ] Tests: close, edit blocked after close (409), reopen, export content equals summary.

### Dev B
- [ ] Review all Phase 2 and 3 queries with Prisma `$queryRaw` or `groupBy` where loops exist. Avoid N+1.
- [ ] Verify indexes with `EXPLAIN` on a seed of ~5 members x 90 days x 3 months.
- [ ] Edge cases pass: member joins mid-month, member leaves mid-month, bazar in previous month, month with no data.
- [ ] Shared `docs/calculation-rules.md`: rounding rule, who is counted, what is locked.
- [ ] Make Dashboard fast (target under 300 ms on seed data).

### Sync point 4
Frontend can build: close month, export button, locked month banner.

---

## 10. Phase 5 - AI Assistant "TallyBot" (4-5 days)

PRD module 7 and section 3.3. Needs Phases 2 and 3 complete.

### Dev A - Provider layer and chat loop
- [ ] `LLMProviderInterface`: `generateChatResponse(messages, tools, systemContext): Promise<AiResponse>`.
- [ ] Normalized types: `AiMessage`, `ToolDefinition`, `ToolCall`, `AiResponse` (text or toolCalls).
- [ ] Adapters: start with **one** real adapter (pick the provider the team has a key for), plus a `MockAdapter` for tests. Add others later, they should need no change outside the adapter file.
- [ ] `providerFactory` reads `AI_PROVIDER` and `AI_API_KEY` from env, fails fast on boot if missing when AI is enabled.
- [ ] `AiAssistantService.chat()` orchestration loop:
  1. build system prompt + context (activeMonth, ACTIVE members list with ids)
  2. call model
  3. if tool calls: run via registry, append results, call model again
  4. cap loop at ~5 iterations, return final text plus any `proposals`
- [ ] `POST /api/ai/chat` - body `{ messages, activeMonth }`, response `{ reply, proposals[] }`. Requires an active membership, resolved by the service.
- [ ] Timeouts, provider error mapping to clean 502/503 `AppError`.
- [ ] Tests with `MockAdapter`: tool loop, iteration cap, provider failure.

### Dev B - Tools and guardrails
- [ ] Tool registry: name, JSON schema (from Zod), handler, type (`read` | `simulate` | `proposal`).
- [ ] Tools (all take the resolved active `messId` and `memberId`, never from the model):
  - `get_monthly_summary` -> summary service
  - `get_member_meals` -> meals service
  - `get_bazar_history` -> bazar service
  - `get_utility_bills` -> utilities service (bills, share, fund)
  - `simulate_meal_rate` -> calculator in dry-run (`additionalBazarAmount`, `additionalMeals`), returns current and projected rate, writes nothing (AC 7.3.1)
  - `propose_meal_entry` and `propose_bazar_entry` -> validate member (name to id), date, amount; return a structured proposal payload, **no DB write** (AC 7.2.1)
- [ ] Name resolution helper: match "Rahim" to a member (case-insensitive, partial). If ambiguous, return candidates so the model asks the user.
- [ ] System prompt file with guardrails: always call tools for numbers, never do arithmetic, answer in the user's language (English or Banglish), never claim a write happened without confirmation.
- [ ] **No write tool exists.** Confirm button calls the normal `POST /api/meals` or `POST /api/bazar` from the frontend, so permissions and validation are identical (AC 7.2.2). Cancel needs no backend call (AC 7.2.3).
- [ ] Per-user rate limit on `/api/ai/chat`, max message length, max history length.
- [ ] Tests: tool outputs equal Summary and Utility endpoints exactly (AC 7.1.1, 7.1.3), simulate does not change DB row counts, proposals do not change DB row counts.

### Sync point 5
Frontend can build: chat drawer, confirmation cards, handling `proposals[]`.

---

## 11. Phase 6 - Hardening and Release (3 days, both)

| Task | Owner |
|---|---|
| Integration test suite (supertest): full flow create mess -> join -> approve -> month -> meals -> bazar -> summary -> close | Dev A |
| Permission matrix tests for every route (outsider, pending, member, manager, owner) | Dev B |
| Rate limiting (global and auth routes), helmet, CORS allowlist for the Next.js origin | Dev B |
| Vercel serverless config, env vars, Prisma connection pooling, cold start check | Dev A |
| Biome lint clean, remove dead code, consistent error codes | Both |
| Final API docs (OpenAPI or Postman collection) | Dev B |
| Bug bash with frontend using seed data | Both |
| Production seed or reset instructions in README | Dev A |

---

## 12. Endpoint Master List

| Method | Path | Guard | Owner | Phase |
|---|---|---|---|---|
| POST | `/api/mess` | auth | A | 1 |
| POST | `/api/mess/join` | auth | A | 1 |
| GET | `/api/mess/my` | auth | A | 1 |
| GET / PATCH | `/api/mess` | member / manager | B | 1 |
| GET | `/api/mess/members` | member | B | 1 |
| GET | `/api/mess/members/pending` | manager | B | 1 |
| PATCH | `/api/mess/members/:id/approve` | manager | B | 1 |
| PATCH | `/api/mess/members/:id/reject` | manager | B | 1 |
| PATCH | `/api/mess/members/:id/manager` | manager / owner | B | 1 |
| PATCH | `/api/mess/members/:id/owner` | owner | B | 1 |
| POST | `/api/mess/leave` | member | B | 1 |
| DELETE | `/api/mess/members/:id` | manager | B | 1 |
| GET / POST | `/api/months` | member / manager | A | 2 |
| PATCH | `/api/months/:id/close` and `/reopen` | manager | A | 4 |
| GET | `/api/meals?month=` | member | A | 2 |
| PUT | `/api/meals` | member | A | 2 |
| POST | `/api/meals/bulk` | member | A | 2 |
| DELETE | `/api/meals/:id` | member | A | 2 |
| GET / POST | `/api/bazar` | member | B | 2 |
| PATCH / DELETE | `/api/bazar/:id` | member | B | 2 |
| GET / POST | `/api/utilities` | member | B | 2 |
| PATCH / DELETE | `/api/utilities/:id` | member | B | 2 |
| PATCH | `/api/utilities/:id/paid` | member | B | 2 |
| GET / POST | `/api/utilities/fund-deposits` | member / manager | B | 2 |
| PATCH / DELETE | `/api/utilities/fund-deposits/:id` | manager | B | 2 |
| GET | `/api/utilities/fund?month=` | member | B | 3 |
| GET | `/api/utilities/replenishment-estimate` | manager | B | 3 |
| GET | `/api/summary?month=` | member | A | 3 |
| GET | `/api/summary/export` | member | A | 4 |
| GET | `/api/dashboard?month=` | member | B | 3 |
| POST | `/api/ai/chat` | member | A | 5 |

Every mess-scoped route needs `checkAuth`; the service then calls `requireActiveMembership(userId)` and adds `assertManager` / `assertOwner` where required.

---

## 13. Frontend Unblock Order

| After | Frontend can build |
|---|---|
| Phase 0 | Everything against mocks from `api-contract.md` |
| Sync 1 | Mess create/join/picker, members, approvals |
| Sync 2 | Meals grid, Bazar, Utility bills, Deposits |
| Sync 3 | Summary page, Dashboard, Utility fund card |
| Sync 4 | Close month, export, locked banner |
| Sync 5 | TallyBot drawer and confirm cards |

---

## 14. Git and Workflow

- Branches: `main` (deploy), `develop` (integration), `feat/<phase>-<short-name>`, e.g. `feat/p2-meals-upsert`.
- One PR per endpoint group, small and reviewable. The other backend dev reviews within a day.
- Commit style: `feat(meals): upsert endpoint`.
- Migrations: only one dev changes `schema.prisma` at a time. Announce in chat before editing, merge the migration first, then continue.
- A task is done when: route works, Zod validation in place, permission checked, tests pass, contract doc updated, Biome clean.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Dev B needs `getOrCreateMonthByDate` early | Dev A ships it in the first 1-2 days of Phase 2 |
| Summary needs bazar and meal data before both exist | Calculator is pure, tested on fixtures. Seed data covers integration |
| Schema change mid-phase breaks the other dev | Single migration owner at a time (Section 14) |
| Rounding makes settlement not sum to zero | Rule D9 plus property-style tests |
| AI provider not chosen yet | `MockAdapter` and interface let Phase 5 start without a key |
| AI numbers differ from Dashboard | Tools call the same services, tested for exact equality |
| PRD naming mismatch (`profileId` vs `memberId`) | Decision D6, told to frontend in Phase 0 |



-- Rules Prisma cannot express. Apply in a custom migration:
--   npx prisma migrate dev --create-only --name db_constraints
-- then paste this file into the generated migration.sql and run: npx prisma migrate dev

ALTER TABLE meal_entry
  ADD CONSTRAINT meal_entry_non_negative
  CHECK (breakfast >= 0 AND lunch >= 0 AND dinner >= 0 AND guest_meals >= 0);

ALTER TABLE meal_expense
  ADD CONSTRAINT meal_expense_amount_positive CHECK (amount > 0);

ALTER TABLE utility_expense
  ADD CONSTRAINT utility_expense_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT utility_expense_paid_consistent CHECK (is_paid OR paid_at IS NULL);

ALTER TABLE deposit
  ADD CONSTRAINT deposit_amount_positive CHECK (amount > 0);

ALTER TABLE mess_month
  ADD CONSTRAINT mess_month_dates_valid CHECK (end_date IS NULL OR end_date >= start_date);

-- Exactly one OWNER row per mess
CREATE UNIQUE INDEX mess_member_one_owner_idx ON mess_member (mess_id) WHERE role = 'OWNER';