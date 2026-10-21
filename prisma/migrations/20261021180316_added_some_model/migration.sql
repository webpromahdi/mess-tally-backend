/*
  Warnings:

  - You are about to drop the column `created_at` on the `deposit` table. All the data in the column will be lost.
  - You are about to drop the column `member_id` on the `deposit` table. All the data in the column will be lost.
  - You are about to drop the column `mess_month_id` on the `deposit` table. All the data in the column will be lost.
  - You are about to drop the column `received_by_id` on the `deposit` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `deposit` table. All the data in the column will be lost.
  - Added the required column `memberId` to the `deposit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `messMonthId` to the `deposit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `receivedById` to the `deposit` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `deposit` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "deposit" DROP CONSTRAINT "deposit_member_id_fkey";

-- DropForeignKey
ALTER TABLE "deposit" DROP CONSTRAINT "deposit_mess_month_id_fkey";

-- DropForeignKey
ALTER TABLE "deposit" DROP CONSTRAINT "deposit_received_by_id_fkey";

-- DropIndex
DROP INDEX "deposit_member_id_idx";

-- DropIndex
DROP INDEX "deposit_mess_month_id_member_id_idx";

-- AlterTable
ALTER TABLE "deposit" DROP COLUMN "created_at",
DROP COLUMN "member_id",
DROP COLUMN "mess_month_id",
DROP COLUMN "received_by_id",
DROP COLUMN "updated_at",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "memberId" TEXT NOT NULL,
ADD COLUMN     "messMonthId" TEXT NOT NULL,
ADD COLUMN     "receivedById" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "deposit_messMonthId_memberId_idx" ON "deposit"("messMonthId", "memberId");

-- CreateIndex
CREATE INDEX "deposit_memberId_idx" ON "deposit"("memberId");

-- AddForeignKey
ALTER TABLE "deposit" ADD CONSTRAINT "deposit_messMonthId_fkey" FOREIGN KEY ("messMonthId") REFERENCES "mess_month"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit" ADD CONSTRAINT "deposit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "mess_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit" ADD CONSTRAINT "deposit_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "mess_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
