-- Custom constraints that Prisma's schema language cannot express.

-- Meal entries can never be negative (AC 3.1.3).
ALTER TABLE meal_entry
  ADD CONSTRAINT meal_entry_non_negative
  CHECK (breakfast >= 0 AND lunch >= 0 AND dinner >= 0 AND "guestMeals" >= 0);

-- Bazar amounts must be positive (AC 4.1.4).
ALTER TABLE meal_expense
  ADD CONSTRAINT meal_expense_amount_positive CHECK (amount > 0);

-- Utility bills: positive amount, and paid_at only when the bill is paid.
ALTER TABLE utility_expense
  ADD CONSTRAINT utility_expense_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT utility_expense_paid_consistent CHECK (is_paid OR paid_at IS NULL);

-- Deposits must be positive (AC 5.2.1).
ALTER TABLE deposit
  ADD CONSTRAINT deposit_amount_positive CHECK (amount > 0);

-- A month cannot end before it starts.
ALTER TABLE mess_month
  ADD CONSTRAINT mess_month_dates_valid CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

-- Payments: positive amount, PAID requires an execution timestamp,
-- refund metadata must be complete or absent.
ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT payments_paid_at_consistent
    CHECK (status <> 'PAID' OR "paidAt" IS NOT NULL),
  ADD CONSTRAINT payments_refund_consistent
    CHECK ("refundTrxId" IS NULL OR ("refundedAt" IS NOT NULL AND "refundAmount" IS NOT NULL));

-- Exactly one OWNER row per mess.
CREATE UNIQUE INDEX mess_member_one_owner_idx
  ON mess_member ("messId") WHERE role = 'OWNER';

-- Fast lookup for the payment reconcile job (abandoned bKash checkouts).
CREATE INDEX payments_reconcile_idx
  ON payments (status, "createdAt") WHERE status IN ('UNPAID', 'PENDING');
