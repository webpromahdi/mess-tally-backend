# Product Requirements Document (PRD): MessTally

**Product Name:** MessTally (formerly Bachelor Meal System)
**Document Status:** Draft — Ready for Engineering Review
**Target Architecture:** Next.js Frontend + Express.js Backend + Provider-Agnostic AI Assistant

---

## 1. Overview

### 1.1 Product Vision & Goal

MessTally is a shared-living meal and expense management platform built for bachelors living together in a flat or mess. It centralizes daily meal counts, grocery shopping (bazar) expenses, and shared household utility bills into a single source of truth. It automatically calculates the monthly meal rate, each member's meal balance, and the optimal peer-to-peer settlements at the end of the month, and it tracks the shared utility advance fund.

**Primary Upgrade Goal:**
Transform the existing working prototype into a production-grade, scalable, AI-powered web application by:

1. Migrating the backend architecture to Express.js while preserving the existing business logic, validation, authentication, and Prisma database layer.
2. Upgrading the frontend to Next.js with Zustand, TanStack Query, and TanStack Form for resilient state management, optimistic updates, caching, and type-safe form handling.
3. Introducing an AI-Powered Mess Assistant (Chatbot, "TallyBot") that allows flatmates to query their meal counts, bazar spending, live meal rates, utility fund status, and settlement math in natural language, simulate "what-if" expense scenarios, and log entries through conversational prompts with human-in-the-loop confirmation.

The chatbot is the only AI feature in this phase. Other AI capabilities will be evaluated after the full application is built.

### 1.2 Target Audience

- **Primary Users (Bachelor Flatmates / Mess Members):** Students, recent graduates, and working professionals sharing a rented flat or mess who split food costs proportionally by meals eaten and split utility costs equally per resident.
- **Secondary Users (Mess Managers):** The designated flatmate(s) responsible for recording daily meal tallies, verifying bazar entries, entering utility bills, collecting the utility advance deposits, and publishing the settlement summary.

### 1.3 Core Value Proposition

- **Zero Manual Math Errors:** Replaces paper meal charts and manual spreadsheet formulas with an automated calculation engine that guarantees 100% mathematical accuracy.
- **Complete Financial Transparency:** Every flatmate can see how the meal rate was derived, every grocery trip logged, and how their personal meal balance was calculated.
- **Minimum-Transaction Debt Settlement:** Uses a greedy settlement matching algorithm to resolve all end-of-month meal dues in the fewest possible peer-to-peer transfers.
- **Clear Utility Fund Tracking:** Shows how much advance deposit has been collected, how much has been spent on utility bills, and when the manager needs to collect the next round.
- **Instant Conversational Clarity (AI Upgrade):** Flatmates can ask the AI chatbot in plain language (English or Banglish) for instant breakdowns, projections, and quick logging.

### 1.4 Requirement Status Legend

Every capability is explicitly tagged to distinguish current verified behavior from planned work:

- **[Existing Functionality]:** Already implemented and verified in the current codebase.
- **[Planned Enhancement]:** Architectural, UX, performance, or reliability upgrades required to make existing features production-grade.
- **[New Feature]:** Net-new functionality introduced in this upgrade phase (specifically the AI Chatbot and supporting capabilities).

### 1.5 Key Design Decisions

1. **Explicit `mess_month` entity.** Each calendar month of activity is represented by a `mess_month` row (status: `ACTIVE` or `CLOSED`). All meal entries, bazar expenses, utility bills, and deposits are scoped to a `mess_month`. The manager opens a new month at the start and can close it when settlement is complete. Records can still be edited while a month is `ACTIVE`.
2. **Meal accounting and utilities are independent.** The meal rate, meal cost, meal balance, and settlement use only meals and bazar data (`meal_entry`, `meal_expense`). Utility bills and deposits are managed separately via `utility_expense` and `deposit` — they never affect the Meal Rate or Meal Balance.
3. **Utility deposits are month-scoped.** Deposits collected from members are recorded against a `mess_month`. The Utility Fund Balance for a given month = deposits collected in that month − utility bills paid in that month.
4. **Member join approval flow.** When a user submits a `room_code` to join a mess, their `mess_member` record starts as `PENDING`. A manager with `is_manager = true` must approve the request, setting status to `ACTIVE`. Members with `PENDING` or `REJECTED` status are excluded from all calculations.
5. **Permission model:** `mess_member.role` (`OWNER` | `MEMBER`) defines the base role. `mess_member.is_manager` is an additional boolean flag that grants manager-level write access (approving members, opening/closing months, recording deposits) without changing ownership.
6. **AI scope.** The chatbot is the only AI feature in this phase.

---

## 2. Functional Requirements (Features & Scope)

### 2.1 Core Modules Breakdown

#### Module 1: Authentication & Access Control (`auth`)

**Module Description & Workflow**

- **[Existing Functionality]** Users authenticate through a dedicated sign-in screen before accessing any protected house records.
- **[Existing Functionality]** The backend verifies credentials via Passport and issues a JSON Web Token (JWT), while auth middleware guards private API endpoints and a frontend route guard blocks unauthenticated access to internal pages.
- **[Planned Enhancement]** Migrate authentication state from basic React Context (`AuthContext`) to a persistent, SSR-compatible Zustand auth store paired with Next.js middleware for seamless route protection without layout flashing.
- **[Planned Enhancement]** Upgrade the login form to use TanStack Form with schema-based field validation, clear inline error feedback, and loading states.

**User Stories & Acceptance Criteria**

**User Story 1.1:** As a bachelor flatmate, I want to sign in securely with my credentials so that only members of our house can view or modify our meal and expense records.

- **AC 1.1.1 (Pass/Fail):** Submitting valid credentials on the login page returns HTTP 200 OK with a valid JWT and redirects the user to the Dashboard.
- **AC 1.1.2 (Pass/Fail):** Submitting invalid credentials returns HTTP 401 Unauthorized and displays a clear error message via TanStack Form without clearing the entered identifier.
- **AC 1.1.3 (Pass/Fail):** Attempting to navigate directly to `/dashboard`, `/meals`, `/bazar`, `/utility`, or `/summary` without a valid session redirects the user to `/login`.
- **AC 1.1.4 (Pass/Fail):** Any API request to protected Express.js Route Handlers without a valid Bearer token is rejected by the JWT Auth Guard with HTTP 401 Unauthorized.

---

#### Module 1.5: Mess Management (`mess`) — [New Feature]

**Module Description & Workflow**

- **[New Feature]** A `mess` entity is the top-level container for all house data. Every `mess_member`, `mess_month`, meal entry, bazar expense, utility bill, and deposit belongs to exactly one mess.
- **[New Feature]** Any authenticated user can create a new mess. Creating a mess automatically generates a unique `room_code` and creates an `OWNER` + `is_manager = true` `mess_member` record for the creator.
- **[New Feature]** A user joins an existing mess by submitting a valid `room_code`. Their `mess_member` is created with `status = PENDING`. If `mess.require_approval = true`, a manager must approve the request before the member gains `ACTIVE` status and access to records.
- **[New Feature]** If `mess.is_joinable = false`, new join requests are rejected outright.
- **[New Feature]** After login, if a user belongs to more than one mess, they select their **active mess**. The selected `messId` is embedded in the JWT payload so every subsequent API request is automatically scoped to the correct mess.
- **[New Feature]** If a user belongs to exactly one mess, that mess is selected automatically after login.
- **[New Feature]** A user can switch their active mess from a settings screen, which triggers a token refresh with the new `messId`.

**User Stories & Acceptance Criteria**

**User Story 1.5.1:** As a user, I want to create a new mess so that I can start tracking meals and expenses for my household.

- **AC 1.5.1.1 (Pass/Fail):** `POST /api/mess` with a valid mess name returns HTTP 201 Created with the new mess record including a unique `room_code`.
- **AC 1.5.1.2 (Pass/Fail):** The creator is automatically assigned an `OWNER` `mess_member` record with `is_manager = true` and `status = ACTIVE`.
- **AC 1.5.1.3 (Pass/Fail):** The returned JWT encodes the newly created `messId` as the user's active mess.

**User Story 1.5.2:** As a user, I want to join an existing mess using a room code so that I can participate in my household's shared records.

- **AC 1.5.2.1 (Pass/Fail):** `POST /api/mess/join` with a valid `room_code` creates a `mess_member` with `status = PENDING` and returns HTTP 201 Created.
- **AC 1.5.2.2 (Pass/Fail):** If `require_approval = false`, status is immediately set to `ACTIVE`.
- **AC 1.5.2.3 (Pass/Fail):** Submitting an invalid `room_code` returns HTTP 404 Not Found.
- **AC 1.5.2.4 (Pass/Fail):** A user who is already a member of the same mess cannot join it again (HTTP 409 Conflict).
- **AC 1.5.2.5 (Pass/Fail):** Joining a mess where `is_joinable = false` is rejected with HTTP 403 Forbidden.

**User Story 1.5.3:** As a manager, I want to approve or reject pending join requests so that only verified flatmates gain access to the house records.

- **AC 1.5.3.1 (Pass/Fail):** `PATCH /api/mess/members/:id/approve` sets `status = ACTIVE`; only a member with `is_manager = true` can call this endpoint.
- **AC 1.5.3.2 (Pass/Fail):** `PATCH /api/mess/members/:id/reject` sets `status = REJECTED`; the rejected user is excluded from all calculations.

**User Story 1.5.4:** As a user who belongs to multiple messes, I want my JWT to carry my active mess so that all API calls are automatically scoped to the correct house.

- **AC 1.5.4.1 (Pass/Fail):** The JWT payload includes a `messId` claim representing the user's currently active mess.
- **AC 1.5.4.2 (Pass/Fail):** Switching the active mess issues a refreshed token with the updated `messId`; all subsequent requests use the new scope.

---

#### Module 2: Flatmate Directory Management (`mess_member`)

**Module Description & Workflow**

- **[Existing Functionality]** Maintains the directory of flatmates (`mess_member`) belonging to a mess. Only members with `status = ACTIVE` are included in meal counts, utility share calculations, and settlement.
- **[Existing Functionality]** Every meal entry, bazar shopping record, and utility deposit is relationally linked to a `mess_member` record.
- **[New Feature]** Members transition through statuses: `PENDING` → `ACTIVE` (on manager approval) → `LEFT` (on voluntary leave). `REJECTED` members have no access.
- **[Planned Enhancement]** Manage directory fetching and mutations via TanStack Query so approving or deactivating a member automatically invalidates and refreshes dependent meal sheets, bazar dropdowns, and summary calculations.
- **[Planned Enhancement]** Prevent deletion of members who already have logged meals or bazar transactions; use `status = LEFT` for soft-archiving instead.

**User Stories & Acceptance Criteria**

**User Story 2.1:** As a mess member, I want to view the list of active flatmates in our house so that daily meals, bazar contributions, and utility shares are assigned only to current residents.

- **AC 2.1.1 (Pass/Fail):** Requesting the member list returns all `mess_member` records for the active mess with their IDs, names, roles, and statuses.
- **AC 2.1.2 (Pass/Fail):** Only members with `status = ACTIVE` appear in Meal, Bazar, and Utility dropdowns.
- **AC 2.1.3 (Pass/Fail):** Attempting to delete a member who has existing meal or bazar records is blocked with a clear validation error; `status = LEFT` must be used instead.

---

#### Module 3: Daily Meal Tracking (`meals`)

**Module Description & Workflow**

- **[Existing Functionality]** Functions as a shared digital meal sheet organized by date (within a selected month) and flatmate.
- **[Existing Functionality]** Records daily meal counts per flatmate and automatically computes each person's monthly meal total as well as the grand total of meals eaten in the house.
- **[Existing Functionality]** Records can be added or edited for any date, including dates in a previous month. A record's month is derived from its date, and summaries always recalculate from the current records.
- **[Planned Enhancement]** Implement TanStack Query optimistic UI updates on the meal grid so toggling or updating meal counts feels instantaneous while syncing with the Express.js backend in the background.
- **[Planned Enhancement]** Use TanStack Form for bulk/daily meal entry validation (preventing negative numbers or invalid dates) and Zustand to persist the currently selected month/date filter across all pages.

**User Stories & Acceptance Criteria**

**User Story 3.1:** As a flatmate, I want to log and view daily meal counts for each member by date so that everyone's monthly food consumption is accurately tracked without paper charts.

- **AC 3.1.1 (Pass/Fail):** Selecting a month loads all daily meal records for every active flatmate for that month.
- **AC 3.1.2 (Pass/Fail):** Adding or updating a flatmate's meal count for a specific date persists the value in the database and immediately recalculates both Person's Total Meals and Total House Meals.
- **AC 3.1.3 (Pass/Fail):** Submitting a negative meal count (< 0) is rejected by both client-side TanStack Form validation and backend Express.js Zod validation with HTTP 400 Bad Request.
- **AC 3.1.4 (Pass/Fail):** Updating a meal count automatically invalidates the cached Dashboard and Monthly Summary queries in TanStack Query so the live Meal Rate updates immediately.
- **AC 3.1.5 (Pass/Fail):** Adding or updating a meal record dated in a previous month is accepted, and the change is reflected when that month is selected.

---

#### Module 4: Grocery Shopping / Bazar Expense Log (`bazar`)

**Module Description & Workflow**

- **[Existing Functionality]** Logs every grocery shopping trip with the date, the flatmate who paid, the amount spent, and optional notes/items.
- **[Existing Functionality]** Credits the spent amount toward that flatmate's personal contribution (Person's Bazar Paid) and aggregates all entries into Total House Bazar Cost for the month.
- **[Existing Functionality]** Entries can be added or edited for any date, including dates in a previous month.
- **[Planned Enhancement]** Build the Bazar entry modal/form with TanStack Form to enforce positive monetary amounts, valid dates, and required shopper selection.
- **[Planned Enhancement]** Use TanStack Query for instant list updates, filtering by shopper or date range, and automatic recalculation of the house meal rate upon every new bazar entry.

**User Stories & Acceptance Criteria**

**User Story 4.1:** As a flatmate who did the grocery shopping, I want to record the date, my name, and the amount I spent on bazar so that my out-of-pocket contribution is credited to me and added to the house food budget.

- **AC 4.1.1 (Pass/Fail):** Submitting a valid bazar entry (`paidByProfileId`, date, amount > 0) creates the record and returns HTTP 201 Created.
- **AC 4.1.2 (Pass/Fail):** The Bazar page displays a chronological list of all shopping trips for the selected month along with each flatmate's cumulative bazar contribution and the total house bazar cost.
- **AC 4.1.3 (Pass/Fail):** Editing or deleting a bazar entry immediately recalculates Person's Bazar Paid, Total House Bazar Cost, and the monthly Meal Rate.
- **AC 4.1.4 (Pass/Fail):** Submitting a bazar entry with an amount <= 0 or a missing `paidByProfileId` fails validation and is blocked from submission.
- **AC 4.1.5 (Pass/Fail):** Adding a bazar entry dated in a previous month is accepted, and the change is reflected when that month is selected.

---

#### Module 5: Utility Bills & Utility Fund Management (`utilities`)

**Module Description & Workflow**

*Utility Bills*

- **[Existing Functionality]** Records fixed monthly household expenses such as electricity (current), gas, internet (wifi), water, and cook/cleaner wages.
- **[Existing Functionality]** Aggregates all utility bills for the selected month and divides the total equally among all active flatmates (Person's Utility Share).
- **[Existing Functionality]** Utility calculations are independent of the meal calculation and the meal settlement. Utility amounts never affect the Meal Rate or Meal Balance.
- **[Planned Enhancement]** Standardize utility category entry and editing using TanStack Form and synchronize updates with the Utilities views via TanStack Query cache invalidation.

*Utility Advance Fund (Deposits)*

- **[New Feature]** Each flatmate gives the manager an advance deposit recorded against the current `mess_month`. Deposits are scoped per month — the manager decides how much to collect each round.
- **[New Feature]** Utility Fund Balance for a month = total `deposit.amount` in that `mess_month` − total `utility_expense.amount` marked `is_paid = true` in that `mess_month`.
- **[Planned Enhancement]** Show the Utility Fund Balance for the active month on the Utility page and Dashboard.
- **[Planned Enhancement]** When the balance is 0 or below, prompt the manager to collect a new round of deposits for the next month.

**User Stories & Acceptance Criteria**

**User Story 5.1:** As a flatmate, I want to log all monthly household utility bills in one place so that fixed living expenses are split equally among all active flatmates.

- **AC 5.1.1 (Pass/Fail):** Adding a utility bill (`category`, `amount`, `mess_month_id`) persists the record and updates the Total Monthly Utility Bills sum for that month.
- **AC 5.1.2 (Pass/Fail):** The system calculates Person's Utility Share = Total Monthly Utility Bills ÷ count of `ACTIVE` members in that mess.
- **AC 5.1.3 (Pass/Fail):** If count of `ACTIVE` members is 0, Utility Share = 0 (no division-by-zero error).
- **AC 5.1.4 (Pass/Fail):** Changing a utility bill does not change the Meal Rate, any Meal Balance, or the settlement list.
- **AC 5.1.5 (Pass/Fail):** `utility_expense.split_type = EQUAL` divides the amount equally; `CUSTOM_WEIGHT` support is available in the schema for future use but not required in this phase.

**User Story 5.2:** As a mess manager, I want to record deposits collected from each flatmate for this month's utility fund so that I can track how much is available to pay bills.

- **AC 5.2.1 (Pass/Fail):** Recording a deposit (`member_id`, `amount > 0`, `mess_month_id`) persists it and increases the month's Total Deposits Collected.
- **AC 5.2.2 (Pass/Fail):** The Utility page displays: Total Deposits Collected, Total Utility Bills Paid, and Utility Fund Balance for the active month.
- **AC 5.2.3 (Pass/Fail):** When Utility Fund Balance ≤ 0, the app displays a replenishment prompt for the next month.

---

#### Module 6: Monthly Meal Summary, Calculator & Settlement Engine (`summary` & `dashboard`)

**Module Description & Workflow**

- **[Existing Functionality]** Serves as the financial core of the meal accounting (`summary.calculator` and `summary.settlement`), powering both the quick-view Dashboard and the detailed Summary page.
- **[Existing Functionality]** Computes the monthly Meal Rate, each person's Meal Cost, and each person's Meal Balance (whether they owe money or are owed a refund).
- **[Existing Functionality]** Runs the settlement matching algorithm (`summary.settlement`) to pair debtors (negative Meal Balance) with creditors (positive Meal Balance) and generate a step-by-step "Who Pays Whom" transaction list.
- **[Existing Functionality]** Summaries are calculated live from the current records for the selected month, including records added or edited after the month ended.
- **[Planned Enhancement]** Rename the former "Net Balance" to **Meal Balance** across the UI, API, and documentation, since it is calculated from meals and bazar only.
- **[Planned Enhancement]** Add consistent two-decimal rounding rules (0.01 precision tolerance) in the Express.js calculation service so rounding discrepancies never prevent the settlement table from balancing to zero.
- **[Planned Enhancement]** Provide an exportable/shareable monthly summary view so flatmates can save or share the final monthly settlement sheet.

**User Stories & Acceptance Criteria**

**User Story 6.1:** As a flatmate, I want to see a complete monthly meal breakdown and a simple list of who needs to pay whom so that we can settle all meal dues accurately without arguments.

- **AC 6.1.1 (Pass/Fail):** When Total House Meals > 0, Meal Rate equals Total House Bazar Cost ÷ Total House Meals; when Total House Meals == 0, Meal Rate equals 0.
- **AC 6.1.2 (Pass/Fail):** For every flatmate, the summary table displays: Total Meals, Meal Cost, Bazar Paid, and Meal Balance.
- **AC 6.1.3 (Pass/Fail):** A flatmate with Meal Balance > 0 is marked as a Receiver (owed money back), and a flatmate with Meal Balance < 0 is marked as a Giver (owes money).
- **AC 6.1.4 (Pass/Fail):** The settlement engine outputs a list of transfers (From Giver -> To Receiver: Amount) where the sum of all transfer amounts equals the total positive Meal Balance (within ±0.01 rounding tolerance) and settles all member balances to 0.
- **AC 6.1.5 (Pass/Fail):** The Summary page and settlement list do not include utility bills or utility fund amounts.

---

#### Module 7: AI Assistant & Conversational Chatbot (`ai-assistant`) — [New Feature]

**Role of the AI Chatbot ("TallyBot")**

The AI Chatbot is designed as an intelligent, context-aware financial and mess operations assistant embedded directly into MessTally (accessible via a floating slide-over drawer on any page and a dedicated view). Instead of acting as a generic chatbot, it connects directly to MessTally's Express.js services via structured Tool Calling / Function Calling to perform four core roles:

1. **Conversational Financial & Meal Q&A (Read-Only Queries):**
   Answers natural-language questions (in English or Banglish/Bengali) using live database data for the active month:
   - "What is our current meal rate right now?"
   - "How many meals did I eat this month, and how much bazar have I paid?"
   - "Why is my meal balance -1,250 TK this month? Break down my calculation."
   - "Who needs to pay whom to settle this month's meal accounts?"
   - "How much is left in the utility fund?"

2. **Assisted Natural-Language Logging with Human-in-the-Loop Confirmation (Write Actions):**
   Flatmates can type quick commands such as:
   - "Log 2 meals for Mahdi today."
   - "Add 1,450 TK bazar by Rahim today for chicken and rice."

   **Safety Guardrail:** The AI never mutates the database silently. It extracts the structured parameters (`profileId`, date, amount/meals) and renders an interactive Confirmation Card inside the chat UI (powered by TanStack Form/Mutation). The record is saved only when the user clicks "Confirm & Save".

3. **"What-If" Meal Rate & Budget Simulator:**
   Flatmates can simulate future spending without touching real records:
   - "If we spend 4,000 TK more on bazar this week and eat 65 more meals, what will the new meal rate be?"

   The chatbot invokes the `SummaryCalculatorService` in dry-run mode and shows the projected meal rate compared to the current meal rate.

4. **Spending Insights & Spike Explanations:**
   Explains trends in plain language, such as identifying which high-cost bazar days caused the meal rate to jump or comparing a member's meal consumption against the house average.

**User Stories & Acceptance Criteria**

**User Story 7.1 (Conversational Q&A):** As a flatmate, I want to ask the AI chatbot questions about my meals, bazar spending, meal rate, utility fund, and final settlement in plain language so that I can get instant answers and math explanations without digging through multiple pages.

- **AC 7.1.1 (Pass/Fail):** Asking the chatbot for the current month's meal rate or a specific flatmate's Meal Balance invokes the Express.js read-only summary service and returns numbers that 100% match the Dashboard and Summary page.
- **AC 7.1.2 (Pass/Fail):** The chatbot cannot hallucinate financial figures; all monetary and meal values in its response must be sourced from the structured tool output returned by the backend.
- **AC 7.1.3 (Pass/Fail):** Asking about the utility fund returns the Utility Fund Balance and total collected amount from the Express.js utilities tool, matching the Utility page.

**User Story 7.2 (Assisted Logging with Confirmation):** As a flatmate, I want to tell the chatbot to log a meal or bazar expense in natural language and confirm it with one click so that recording daily activity is faster than filling out forms manually.

- **AC 7.2.1 (Pass/Fail):** Sending a prompt like "Add 800 TK bazar for [Flatmate Name] today" returns a structured confirmation card pre-filled with the resolved flatmate, date, and amount, without writing to the database yet.
- **AC 7.2.2 (Pass/Fail):** Clicking "Confirm" on the chat confirmation card triggers the Express.js creation endpoint, saves the record, invalidates the relevant TanStack Query caches, and displays a success state in the chat.
- **AC 7.2.3 (Pass/Fail):** Clicking "Cancel" discards the proposed entry with zero database changes.

**User Story 7.3 ("What-If" Simulation):** As a flatmate, I want to ask the chatbot "what-if" questions about future bazar spending and meals so that we can plan our remaining monthly food budget.

- **AC 7.3.1 (Pass/Fail):** Asking a hypothetical projection question runs the calculation formula in memory without altering any database records and returns both the current meal rate and the projected meal rate.

---

### 2.2 Core Financial Formulas & Calculation Specification

All backend calculation services (`summaryCalculatorService` and `summarySettlementService`) and AI simulation tools must strictly enforce the following formulas.

#### A. Meal Accounting & Settlement Formulas

| # | Formula Name | Mathematical Definition | Module Applied | Edge-Case / Validation Rule |
|---|---|---|---|---|
| 1 | Total Monthly Meals | Total House Meals = Σ (Person's Daily Meals) where Person's Daily Meals = breakfast + lunch + dinner + guest_meals | meals, dashboard, summary, ai-assistant | Defaults to 0 if no meal entries exist for the month. `guest_meals` counts toward the house total and affects the meal rate. |
| 2 | Total Bazar Spending | Total House Bazar Cost = Σ (Bazar Trip Amount) | bazar, dashboard, summary, ai-assistant | Defaults to 0 if no bazar trips exist for the month. |
| 3 | Meal Rate | Meal Rate = Total House Bazar Cost ÷ Total House Meals | dashboard, summary, ai-assistant | If Total House Meals = 0, Meal Rate = 0 (prevents division by zero). |
| 4 | Individual Meal Cost | Person's Meal Cost = Person's Total Meals × Meal Rate, where Person's Total Meals = Σ (breakfast + lunch + dinner + guest_meals) for that person | summary, ai-assistant | Guest meals are included in a person's total; they are billed at the same meal rate as regular meals. Calculated using full floating-point precision internally; rounded for display. |
| 5 | Meal Balance (Meal Due / Refund) — *renamed from "Net Balance"* | Meal Balance = Person's Bazar Paid − Person's Meal Cost | summary, ai-assistant | Meal Balance > 0: owed a refund (Receiver). Meal Balance < 0: owes money (Giver). Utility amounts are not included. |
| 6 | Settlement Matching | Transfer Amount = min(\|Giver Meal Balance\|, Receiver Meal Balance) | summary (`summary.settlement`), ai-assistant | Iteratively pairs Givers and Receivers, subtracting Transfer Amount from both until all balances reach 0. |

#### B. Utility Formulas (independent of meal accounting)

| # | Formula Name | Mathematical Definition | Module Applied | Edge-Case / Validation Rule |
|---|---|---|---|---|
| U1 | Per-Person Utility Share | Person's Utility Share = Total Monthly Utility Bills ÷ Count of `ACTIVE` Members in the Mess | utilities, ai-assistant | Only `mess_member` rows with `status = ACTIVE` are counted. `PENDING`, `LEFT`, and `REJECTED` members are excluded. If count = 0, Utility Share = 0. |
| U2 | Utility Fund Balance | Utility Fund Balance = Σ `deposit.amount` for the month − Σ `utility_expense.amount` where `is_paid = true` for the month | utilities, dashboard, ai-assistant | Scoped to the active `mess_month`. Balance ≤ 0 triggers the replenishment prompt for the next month. |
| U3 | Replenishment Estimate | Total Expected = Desired Deposit per Member × Count of `ACTIVE` Members | utilities | The manager sets the deposit amount per round; there is no fixed default enforced in the schema. |

### 2.3 Out of Scope (Current Phase)

To prevent scope creep during the production and AI upgrade, the following items are strictly out of scope for this phase:

- **Utility `split_type = CUSTOM_WEIGHT`:** The `utility_expense.split_type` column exists in the schema for future use. Only `EQUAL` split is implemented in this phase.
- **Utility Costs in Meal Settlement:** Utility bills and deposits are not part of the meal balance or settlement calculation.
- **Mess Plan / SaaS Billing:** The `mess.plan` and `mess.plan_expires_at` columns exist in the schema but billing tiers are not implemented in this phase.
- **Meal Cutoff Time Enforcement:** `mess.meal_cutoff_time` is stored but not enforced server-side in this phase.
- **Rent Tracking:** `mess_member.rent_share` and `fixed_rent_amount` columns are reserved for future use; rent splitting is not calculated in this phase.
- **Receipt / Image Upload:** `meal_expense.receipt_url` and `utility_expense.receipt_url` columns exist in the schema but file upload is deferred.
- **AI Features Beyond the Chatbot:** Additional AI capabilities will be evaluated after the full application is built.
- **Member Fine & Penalty Tracking:** Excluded from the bachelor feature set per product direction.
- **In-App Payment Gateway Integration:** MessTally calculates who pays whom, but actual money transfers (e.g., bKash, Nagad, bank transfer) happen outside the app.
- **Multi-Tenant SaaS Billing & Subscription Plans:** Core flat/mess management is the focus before paid tiers.
- **Native Mobile Apps (iOS / Android):** The frontend will be delivered as a responsive Next.js web application optimized for mobile browsers.
- **Autonomous Unconfirmed AI Database Writes:** The AI chatbot will never delete records or modify existing records without explicit user confirmation.

---

## 3. Technical Architecture & Tech Stack

### 3.1 High-Level System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER (Next.js App Router)                            │
│                                                                                        │
│  ┌────────────────────────┐  ┌────────────────────────┐  ┌──────────────────────────┐  │
│  │       UI & Pages       │  │      Client State      │  │    Forms & Validation    │  │
│  │    Dashboard, Meals,   │  │        Zustand         │  │      TanStack Form       │  │
│  │    Bazar, Utility,     │  │ (Auth Session, Active  │  │    (Type-safe forms,     │  │
│  │    Summary, AI Chat UI │  │  Month Filter, Chat UI)│  │     Zod validation)      │  │
│  └───────────┬────────────┘  └───────────┬────────────┘  └────────────┬─────────────┘  │
│              │                           │                            │                │
│              └───────────────────────────┼────────────────────────────┘                │
│                                          │                                             │
│                          ┌───────────────▼───────────────┐                             │
│                          │   Server State & Data Layer   │                             │
│                          │        TanStack Query         │                             │
│                          │ (Caching, Optimistic Updates, │                             │
│                          │  Auto-Invalidation, Retries)  │                             │
│                          └───────────────┬───────────────┘                             │
└──────────────────────────────────────────┼─────────────────────────────────────────────┘
                                           │ HTTPS / REST JSON (JWT Bearer)
┌──────────────────────────────────────────▼─────────────────────────────────────────────┐
│                           BACKEND LAYER (Express.js framework)                             │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │            Global Guards, Interceptors & Pipes (Passport JWT, Zod/DTO,          │  │
│  │                     Standardized ApiResponse, Global Error Filter)               │  │
│  └───────────────────────────────────────┬──────────────────────────────────────────┘  │
│                                          │                                             │
│  ┌────────────────┐ ┌────────────────┐ ┌──┴────────────┐ ┌──────────────────────────┐  │
│  │   AuthModule   │ │ ProfilesModule │ │  MealsModule  │ │       BazarModule        │  │
│  └────────────────┘ └────────────────┘ └───────────────┘ └──────────────────────────┘  │
│  ┌────────────────┐ ┌─────────────────────────────────┐ ┌───────────────────────────┐  │
│  │UtilitiesModule │ │          SummaryModule          │ │     AiAssistantModule     │  │
│  │                │ │ (Calculator & Settlement Engine)│ │   (Tool Orchestrator &    │  │
│  └────────┬───────┘ └────────────────┬────────────────┘ │    LLM Provider Adapter   │  │
│           │                          │                  └────────────┬──────────────┘  │
│           └──────────────────────────┼───────────────────────────────┘                 │
│                                      │                                                 │
│                          ┌───────────▼───────────┐                                     │
│                          │     PrismaService     │                                     │
│                          │     (Prisma ORM)      │                                     │
│                          └───────────┬───────────┘                                     │
└──────────────────────────────────────┼─────────────────────────────────────────────────┘
                                       │
                        ┌──────────────┴──────────────┐
                        │                             │
             ┌──────────▼──────────┐       ┌──────────▼──────────┐
             │ Relational Database │       │ External AI Provider│
             │    (PostgreSQL)     │       │ (Gemini / OpenAI /  │
             │                     │       │  Claude / Groq API) │
             └─────────────────────┘       └─────────────────────┘
```

### 3.2 Tech Stack Breakdown

#### A. Backend Stack (Express.js — Core Framework)

- **Core Framework:** Express.js (Node.js + TypeScript) — structured with modular domain routers (`auth`, `profiles`, `meals`, `bazar`, `utilities`, `summary`) organized by feature for clean separation of concerns.
- **Database & ORM:** Prisma ORM (Prisma Client via a shared `prisma.ts` singleton) with PostgreSQL, preserving the existing schema, seed scripts, and reset utilities.
- **Authentication & Security:** Passport.js (`passport-jwt`) and JWT (`jsonwebtoken`), preserving the existing `checkAuth` middleware and `jwt.ts` utility as reusable Express.js middleware guards.
- **Validation & Error Handling:** Retains schema validation using Zod (`validateRequest` middleware) and preserves the standardized `apiResponse` envelope and `AppError` handling via a global Express.js error handler.
- **Date & Time Utilities:** Retains the existing `date.util.ts` logic for month boundary parsing and UTC date consistency. The month of a record is derived from its date.
- **Code Quality & Tooling:** Biome (`biome.json`) for fast linting and formatting, TypeScript, and Vercel serverless deployment configuration.

#### B. Frontend Stack (Next.js + Zustand + TanStack Query + TanStack Form)

- **Core Framework:** Next.js (App Router) with React and TypeScript — upgrades the existing Vite SPA to support hybrid rendering, route-level middleware protection, and production bundle optimization.
- **Client State Management:** Zustand — manages global client-side state including:
  - Authenticated user session & token state (replacing `AuthContext.tsx`).
  - Active selected month/year filter shared across Dashboard, Meals, Bazar, Utility, and Summary views.
  - AI Chatbot drawer open/close state and pending confirmation actions.
- **Server State & Data Fetching:** TanStack Query (React Query) — wraps the existing API client (`src/lib/api.ts`) to provide:
  - Automatic caching and background refetching per selected month.
  - Cross-module cache invalidation (e.g., logging a bazar trip or meal immediately invalidates `['summary', month]` and `['dashboard', month]`).
  - Optimistic UI updates when toggling daily meal counts.
- **Form State & Validation:** TanStack Form — powers all data entry workflows (Login, Add Flatmate, Daily Meal Entry, Bazar Expense Form, Utility Bill Form, Utility Fund Deposit Form) with type-safe field validation and dirty/submitting state tracking.
- **Styling & UI Components:** Retains the existing Tailwind CSS styling system, responsive mobile-first design patterns (`doc/responsive.md`), and icon libraries.

### 3.3 AI Chatbot Architecture (Provider-Agnostic Design)

Because the specific AI provider/API will be finalized after evaluating options (such as Google Gemini, OpenAI, Anthropic Claude, or Groq), the backend `aiAssistantRouter` in Express.js is designed around the Adapter / Strategy Pattern (or a unified SDK such as Vercel AI SDK Core / LangChain adapter) so switching providers requires changing only an environment variable (`AI_PROVIDER` and `AI_API_KEY`).

**1. Provider-Agnostic `LLMProviderInterface`**

The Express.js `AiAssistantService` communicates with an abstract interface rather than hardcoding a single vendor's SDK:

`generateChatResponse(messages, tools, systemContext): Promise<AiResponse>`

Concrete adapters (e.g., `GeminiAdapter`, `OpenAiAdapter`, `GroqAdapter`) implement this interface and translate tool definitions into the provider's native function-calling format.

**2. Express.js Tool / Function Calling Registry**

The AI Assistant interacts with MessTally exclusively through registered Express.js service functions:

| Tool Name | Type | Connected Express.js Service | Description |
|---|---|---|---|
| `get_monthly_summary` | Read-Only | SummaryService | Fetches total meals, total bazar, meal rate, per-person meal breakdown (meals, meal cost, bazar paid, meal balance), and settlement transfers for a given month. |
| `get_member_meals` | Read-Only | MealsService | Retrieves daily and total meal counts for a specific flatmate or the entire house for a date range or month. |
| `get_bazar_history` | Read-Only | BazarService | Retrieves bazar shopping entries filtered by flatmate, date, or month. |
| `get_utility_bills` | Read-Only | UtilitiesService | Retrieves all utility bill items, the per-person utility share, and the utility fund status (total collected, spent, and balance) for a given month. |
| `simulate_meal_rate` | Simulation (Pure) | SummaryCalculatorService | Accepts hypothetical `additionalBazarAmount` and `additionalMeals` and returns the projected meal rate and per-person meal cost impact. |
| `propose_meal_entry` | Write Proposal | MealsService (Draft) | Validates flatmate name, date, and meal count, returning a structured payload that renders a Confirm Meal Entry card on the frontend. |
| `propose_bazar_entry` | Write Proposal | BazarService (Draft) | Validates shopper name, date, and bazar amount, returning a structured payload that renders a Confirm Bazar Entry card on the frontend. |

**3. AI Guardrails & Grounding Rules**

- **Zero-Math-Hallucination Rule:** The system prompt strictly instructs the LLM never to perform mental arithmetic on raw lists; it must always call `get_monthly_summary`, `get_utility_bills`, or `simulate_meal_rate` and report the exact numbers computed by `summaryCalculatorService` and `summarySettlementService`.
- **Context Injection:** Every chat request automatically receives the user's current `activeMonth` (from Zustand) and the list of active flatmates (`ProfilesService`) so the AI can accurately match names like "Rahim" to their database `profileId`.

### 3.4 Frontend-to-Backend Data Flow Matrix

| User Action | Frontend Handler | State / Cache Impact | Express.js Route Handler |
|---|---|---|---|
| User Logs In | TanStack Form -> POST `/api/auth/login` | Saves JWT & user profile in Zustand auth store | `authRouter.post("/login")` |
| User Changes Month | Month Selector UI | Updates `activeMonth` in Zustand; triggers TanStack Query refetch for active view | Passed as `?month=YYYY-MM` query param |
| User Logs Meals | TanStack Form + TanStack Query Mutation | Optimistically updates `['meals', month]`; invalidates `['summary', month]` | `mealsRouter` (POST / PATCH `/api/meals`) |
| User Adds Bazar | TanStack Form + TanStack Query Mutation | Invalidates `['bazar', month]` and `['summary', month]` | `bazarRouter` (POST `/api/bazar`) |
| User Updates Utility Bill | TanStack Form + TanStack Query Mutation | Invalidates `['utilities', month]` and `['utility-fund']` (not the meal summary) | `utilitiesRouter` (POST / PATCH `/api/utilities`) |
| User Records Fund Deposit | TanStack Form + TanStack Query Mutation | Invalidates `['utility-fund']` and `['utilities', month]` | `utilitiesRouter` (POST `/api/utilities/fund-deposits`) |
| User Asks Chatbot | Chat UI -> TanStack Query Mutation | Appends message to Zustand chat state; renders Confirmation Card if action proposed | `aiRouter` (POST `/api/ai/chat`) |

### 3.5 Database Entities (Naming)

| Table | Key Columns | Purpose |
|---|---|---|
| `users` | `id` (TEXT), `email`, `password_hash`, `name`, `phone`, `avatar_url`, `created_at`, `updated_at` | Login accounts. One user can be a member of multiple messes through separate `mess_member` rows. |
| `mess` | `id` (TEXT), `name`, `address`, `currency`, `room_code` (unique), `is_joinable`, `require_approval`, `plan` (`FREE`\|`PRO`), `plan_expires_at`, `meal_cutoff_time`, `created_at`, `updated_at` | Top-level tenant container. `room_code` is the invite code. All accounting records are scoped to a `mess_id`. |
| `mess_member` | `id` (TEXT), `user_id`, `mess_id`, `role` (`OWNER`\|`MEMBER`), `status` (`PENDING`\|`ACTIVE`\|`LEFT`\|`REJECTED`), `is_manager` (BOOLEAN), `rent_share`, `fixed_rent_amount`, `joined_at`, `left_at`, `updated_at` | Flatmate directory entry. `status = ACTIVE` is required for inclusion in all calculations. `is_manager = true` grants manager-level write access. Unique on `(user_id, mess_id)`. |
| `mess_month` | `id` (TEXT), `mess_id`, `name`, `start_date`, `end_date`, `status` (`ACTIVE`\|`CLOSED`), `manager_id`, `locked_meal_rate`, `locked_total_meals`, `locked_total_bazar`, `locked_total_utilities`, `created_at`, `updated_at` | Represents one calendar month of activity. All meal entries, bazar expenses, utility bills, and deposits are scoped to a `mess_month`. `manager_id` → `mess_member`. |
| `meal_entry` | `id` (TEXT), `mess_month_id`, `member_id`, `date` (DATE), `breakfast`, `lunch`, `dinner`, `guest_meals` (all DOUBLE PRECISION), `is_locked`, `updated_at` | Daily meal record per member per date. Total meals = `breakfast + lunch + dinner + guest_meals`. Unique on `(mess_month_id, member_id, date)`. FK → `mess_month`, `mess_member`. |
| `meal_expense` | `id` (TEXT), `mess_month_id`, `title`, `items`, `amount` (DECIMAL), `bazar_date` (DATE), `receipt_url`, `paid_from_mess_fund` (BOOLEAN), `shopper_id`, `added_by_id`, `created_at`, `updated_at` | Grocery/bazar shopping record. `shopper_id` and `added_by_id` → `mess_member`. FK → `mess_month`. |
| `utility_expense` | `id` (TEXT), `mess_month_id`, `category` (`RENT`\|`ELECTRICITY`\|`GAS`\|`WATER`\|`WIFI`\|`COOK_SALARY`\|`GARBAGE_GUARD`\|`OTHER`), `title`, `amount` (DECIMAL), `split_type` (`EQUAL`\|`CUSTOM_WEIGHT`), `due_date`, `is_paid`, `paid_at`, `receipt_url`, `notes`, `paid_by_id`, `added_by_id`, `created_at`, `updated_at` | Individual utility bill for a month. `paid_by_id` → `mess_member`. FK → `mess_month`. |
| `deposit` | `id` (TEXT), `mess_month_id`, `member_id`, `received_by_id`, `amount` (DECIMAL), `date`, `note`, `created_at`, `updated_at` | Advance deposit collected from a member for the month's utility fund. `member_id` and `received_by_id` → `mess_member`. FK → `mess_month`. |