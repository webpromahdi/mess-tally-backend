import type {
	UtilityCategory,
	UtilitySplitType,
} from "../../../generated/prisma/enums";
import type { IMonthContext } from "../messMonth/month.interface";

export interface IUtilityBill {
	id: string;
	messMonthId: string;
	category: UtilityCategory;
	title: string;
	amount: number;
	splitType: UtilitySplitType;
	dueDate: string | null;
	isPaid: boolean;
	paidAt: Date | null;
	paidById: string | null;
	paidByName: string | null;
	notes: string | null;
	addedById: string;
	addedByName: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface IUtilityTotals {
	total: number;
	paid: number;
	unpaid: number;
	activeMemberCount: number;
	perPersonShare: number;
}

export interface IUtilityListResult {
	month: IMonthContext;
	bills: IUtilityBill[];
	totals: IUtilityTotals;
}

export interface IUtilityBillResult {
	bill: IUtilityBill;
}

export interface IUtilityFundSummary {
	month: IMonthContext;
	totalDeposits: number;
	totalPaidBills: number;
	balance: number;
	needsReplenishment: boolean;
}

/** Utility values captured when a month is closed. Not exposed by Summary. */
export interface IUtilitySnapshot {
	totalBills: number;
	totalPaidBills: number;
	totalUnpaidBills: number;
	totalDeposits: number;
	balance: number;
	needsReplenishment: boolean;
	activeMemberCount: number;
	perPersonShare: number;
}

export interface IReplenishmentEstimate {
	perMember: number;
	activeMemberCount: number;
	totalExpected: number;
}

export interface IDeleteUtilityResult {
	id: string;
	deleted: true;
}
