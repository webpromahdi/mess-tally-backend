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

export interface IDeleteUtilityResult {
	id: string;
	deleted: true;
}
