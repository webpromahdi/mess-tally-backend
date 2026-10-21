-- Drop indexes that are redundant with an existing composite index or
-- filter on a low-cardinality column with negligible selectivity.

-- Covered by mess_month_mess_start_key (leads with "messId"); status is binary.
DROP INDEX "mess_month_messId_status_idx";

-- isManager is boolean; mess_member_messId_status_idx already narrows to one mess
-- and keeps the Mess -> MessMember cascade indexed.
DROP INDEX "mess_member_messId_isManager_idx";

-- isPaid is boolean; utility_expense_mess_month_id_category_idx already covers
-- month lookups and cascades.
DROP INDEX "utility_expense_mess_month_id_is_paid_idx";

-- shopperId alone is indexed, and messMonthId is covered by
-- meal_expense_messMonthId_bazarDate_idx.
DROP INDEX "meal_expense_messMonthId_shopperId_idx";

-- Drift cleanup: never declared in the Prisma schema. Covered by
-- payments_messId_status_idx and the partial payments_reconcile_idx.
DROP INDEX "payments_status_idx";
