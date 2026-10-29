import type { MemberStatus } from "../../../generated/prisma/enums";
import type { IMonthContext } from "../messMonth/month.interface";
import type { IUtilitySnapshot } from "../utility/utility.interface";

/** Settlement role derived from the final, cent-normalized meal balance. */
export type TBalanceStatus = "RECEIVER" | "GIVER" | "SETTLED";

/**
 * One member's raw ledger input for the pure calculator. `totalMeals` already
 * includes guest meals; `bazarPaid` is the sum of trips where this member was
 * the shopper.
 */
export interface IMemberLedgerInput {
	memberId: string;
	totalMeals: number;
	bazarPaid: number;
}

/** Full-precision calculator output for one member. */
export interface IMemberCalculation {
	memberId: string;
	totalMeals: number;
	mealCost: number;
	bazarPaid: number;
	mealBalance: number;
}

/** Full-precision formulas 1-5 for the whole house. */
export interface ISummaryCalculation {
	totalMeals: number;
	totalBazar: number;
	mealRate: number;
	members: IMemberCalculation[];
}

/** A raw balance passed into the pure settlement engine. */
export interface ISettlementMemberInput {
	memberId: string;
	mealBalance: number;
}

export interface ISettlementTransfer {
	fromMemberId: string;
	toMemberId: string;
	amount: number;
}

/** A balance after cent normalization, suitable for the response. */
export interface ISettledBalance {
	memberId: string;
	mealBalance: number;
	balanceStatus: TBalanceStatus;
}

export interface ISettlementResult {
	transfers: ISettlementTransfer[];
	balances: ISettledBalance[];
	/**
	 * `false` only when the ledger cannot be balanced (for example, bazar was
	 * recorded but the month has no meals, so every balance is positive).
	 */
	canSettle: boolean;
	totalPositiveBalance: number;
}

export interface ISummaryMember {
	memberId: string;
	name: string;
	avatarUrl: string | null;
	status: MemberStatus;
	totalMeals: number;
	mealCost: number;
	bazarPaid: number;
	mealBalance: number;
	balanceStatus: TBalanceStatus;
}

export interface ISummaryTotals {
	totalMeals: number;
	totalBazar: number;
	mealRate: number;
	totalPositiveBalance: number;
}

export interface ISummaryResult {
	month: IMonthContext;
	canSettle: boolean;
	totals: ISummaryTotals;
	members: ISummaryMember[];
	settlement: ISettlementTransfer[];
	/** True when these figures came from a closed month's locked snapshot. */
	isLocked: boolean;
}

/**
 * Persisted in `MessMonth.lockedSnapshot`. Utility values are kept here for
 * audit only; Summary and export never expose them (AC 6.1.5).
 */
export interface ILockedMonthSnapshot {
	version: 1;
	closedAt: string;
	summary: ISummaryResult;
	utility: IUtilitySnapshot;
}
