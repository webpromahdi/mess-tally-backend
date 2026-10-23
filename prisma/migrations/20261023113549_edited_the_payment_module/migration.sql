/*
  Warnings:

  - You are about to drop the column `messMonthId` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `payment_id` on the `utility_expense` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_messMonthId_fkey";

-- DropForeignKey
ALTER TABLE "utility_expense" DROP CONSTRAINT "utility_expense_payment_id_fkey";

-- DropIndex
DROP INDEX "payments_messMonthId_idx";

-- DropIndex
DROP INDEX "utility_expense_payment_key";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "messMonthId";

-- AlterTable
ALTER TABLE "utility_expense" DROP COLUMN "payment_id";
