-- CreateEnum
CREATE TYPE "MessRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('PENDING', 'ACTIVE', 'LEFT', 'REJECTED');

-- CreateEnum
CREATE TYPE "MessPlan" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "MonthStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "UtilityCategory" AS ENUM ('RENT', 'ELECTRICITY', 'GAS', 'WATER', 'WIFI', 'COOK_SALARY', 'GARBAGE_GUARD', 'SUBSCRIPTION', 'OTHER');

-- CreateEnum
CREATE TYPE "UtilitySplitType" AS ENUM ('EQUAL', 'CUSTOM_WEIGHT');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('SUBSCRIPTION_MONTHLY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "deposit" (
    "id" TEXT NOT NULL,
    "mess_month_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "received_by_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_entry" (
    "id" TEXT NOT NULL,
    "messMonthId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "breakfast" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lunch" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dinner" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "guestMeals" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_expense" (
    "id" TEXT NOT NULL,
    "messMonthId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "items" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "bazarDate" DATE NOT NULL DEFAULT CURRENT_DATE,
    "receiptUrl" TEXT,
    "paidFromMessFund" BOOLEAN NOT NULL DEFAULT false,
    "shopperId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mess_member" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messId" TEXT NOT NULL,
    "role" "MessRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MemberStatus" NOT NULL DEFAULT 'PENDING',
    "isManager" BOOLEAN NOT NULL DEFAULT false,
    "rentShare" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "fixedRentAmount" DECIMAL(10,2),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mess_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mess_month" (
    "id" TEXT NOT NULL,
    "messId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "MonthStatus" NOT NULL DEFAULT 'ACTIVE',
    "managerId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "lockedMealRate" DECIMAL(10,2),
    "lockedTotalMeals" DOUBLE PRECISION,
    "lockedTotalBazar" DECIMAL(10,2),
    "lockedTotalUtilities" DECIMAL(10,2),
    "lockedSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mess_month_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mess" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "roomCode" TEXT NOT NULL,
    "isJoinable" BOOLEAN NOT NULL DEFAULT true,
    "requireApproval" BOOLEAN NOT NULL DEFAULT true,
    "plan" "MessPlan" NOT NULL DEFAULT 'FREE',
    "planExpiresAt" TIMESTAMP(3),
    "mealCutoffTime" TEXT DEFAULT '11:00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "messId" TEXT NOT NULL,
    "paidByMemberId" TEXT NOT NULL,
    "messMonthId" TEXT,
    "type" "PaymentType" NOT NULL DEFAULT 'SUBSCRIPTION_MONTHLY',
    "status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "paymentGateway" TEXT NOT NULL DEFAULT 'bkash',
    "merchantInvoiceNumber" TEXT NOT NULL,
    "bkashPaymentId" TEXT,
    "bkashTrxId" TEXT,
    "payerReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "gatewayResponse" JSONB,
    "refundTrxId" TEXT,
    "refundAmount" DECIMAL(10,2),
    "refundReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utility_expense" (
    "id" TEXT NOT NULL,
    "mess_month_id" TEXT NOT NULL,
    "category" "UtilityCategory" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "split_type" "UtilitySplitType" NOT NULL DEFAULT 'EQUAL',
    "due_date" DATE,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "paid_at" TIMESTAMP(3),
    "receipt_url" TEXT,
    "notes" TEXT,
    "paid_by_id" TEXT,
    "added_by_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "utility_expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deposit_mess_month_id_member_id_idx" ON "deposit"("mess_month_id", "member_id");

-- CreateIndex
CREATE INDEX "deposit_member_id_idx" ON "deposit"("member_id");

-- CreateIndex
CREATE INDEX "meal_entry_messMonthId_date_idx" ON "meal_entry"("messMonthId", "date");

-- CreateIndex
CREATE INDEX "meal_entry_memberId_idx" ON "meal_entry"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_entry_month_member_date_key" ON "meal_entry"("messMonthId", "memberId", "date");

-- CreateIndex
CREATE INDEX "meal_expense_messMonthId_bazarDate_idx" ON "meal_expense"("messMonthId", "bazarDate");

-- CreateIndex
CREATE INDEX "meal_expense_messMonthId_shopperId_idx" ON "meal_expense"("messMonthId", "shopperId");

-- CreateIndex
CREATE INDEX "meal_expense_shopperId_idx" ON "meal_expense"("shopperId");

-- CreateIndex
CREATE INDEX "mess_member_messId_status_idx" ON "mess_member"("messId", "status");

-- CreateIndex
CREATE INDEX "mess_member_messId_isManager_idx" ON "mess_member"("messId", "isManager");

-- CreateIndex
CREATE UNIQUE INDEX "mess_member_user_mess_key" ON "mess_member"("userId", "messId");

-- CreateIndex
CREATE INDEX "mess_month_messId_status_idx" ON "mess_month"("messId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mess_month_mess_start_key" ON "mess_month"("messId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "mess_roomCode_key" ON "mess"("roomCode");

-- CreateIndex
CREATE UNIQUE INDEX "payments_merchantInvoiceNumber_key" ON "payments"("merchantInvoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_bkashPaymentId_key" ON "payments"("bkashPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_bkashTrxId_key" ON "payments"("bkashTrxId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_refundTrxId_key" ON "payments"("refundTrxId");

-- CreateIndex
CREATE INDEX "payments_messId_status_idx" ON "payments"("messId", "status");

-- CreateIndex
CREATE INDEX "payments_messMonthId_idx" ON "payments"("messMonthId");

-- CreateIndex
CREATE INDEX "payments_paidByMemberId_idx" ON "payments"("paidByMemberId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "utility_expense_payment_key" ON "utility_expense"("payment_id");

-- CreateIndex
CREATE INDEX "utility_expense_mess_month_id_category_idx" ON "utility_expense"("mess_month_id", "category");

-- CreateIndex
CREATE INDEX "utility_expense_mess_month_id_is_paid_idx" ON "utility_expense"("mess_month_id", "is_paid");

-- AddForeignKey
ALTER TABLE "deposit" ADD CONSTRAINT "deposit_mess_month_id_fkey" FOREIGN KEY ("mess_month_id") REFERENCES "mess_month"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit" ADD CONSTRAINT "deposit_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "mess_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit" ADD CONSTRAINT "deposit_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "mess_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_entry" ADD CONSTRAINT "meal_entry_messMonthId_fkey" FOREIGN KEY ("messMonthId") REFERENCES "mess_month"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_entry" ADD CONSTRAINT "meal_entry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "mess_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_entry" ADD CONSTRAINT "meal_entry_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "mess_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_expense" ADD CONSTRAINT "meal_expense_messMonthId_fkey" FOREIGN KEY ("messMonthId") REFERENCES "mess_month"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_expense" ADD CONSTRAINT "meal_expense_shopperId_fkey" FOREIGN KEY ("shopperId") REFERENCES "mess_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_expense" ADD CONSTRAINT "meal_expense_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "mess_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mess_member" ADD CONSTRAINT "mess_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mess_member" ADD CONSTRAINT "mess_member_messId_fkey" FOREIGN KEY ("messId") REFERENCES "mess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mess_month" ADD CONSTRAINT "mess_month_messId_fkey" FOREIGN KEY ("messId") REFERENCES "mess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mess_month" ADD CONSTRAINT "mess_month_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "mess_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mess_month" ADD CONSTRAINT "mess_month_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "mess_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_messId_fkey" FOREIGN KEY ("messId") REFERENCES "mess"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_paidByMemberId_fkey" FOREIGN KEY ("paidByMemberId") REFERENCES "mess_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_messMonthId_fkey" FOREIGN KEY ("messMonthId") REFERENCES "mess_month"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_expense" ADD CONSTRAINT "utility_expense_mess_month_id_fkey" FOREIGN KEY ("mess_month_id") REFERENCES "mess_month"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_expense" ADD CONSTRAINT "utility_expense_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "mess_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_expense" ADD CONSTRAINT "utility_expense_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "mess_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_expense" ADD CONSTRAINT "utility_expense_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
