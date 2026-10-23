ALTER TABLE "meal_expense"
ADD COLUMN "receipt_public_id" TEXT;

CREATE INDEX "payments_messId_createdAt_idx"
ON "payments"("messId", "createdAt");
