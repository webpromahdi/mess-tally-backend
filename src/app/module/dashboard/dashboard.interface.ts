import type { IMonthContext } from "../messMonth/month.interface";
import type { TBalanceStatus } from "../summary/summary.interface";

/** The caller's own meal ledger on the Dashboard. */
export interface IDashboardMemberMeal {
	memberId: string;
	totalMeals: number;
	mealCost: number;
	bazarPaid: number;
	mealBalance: number;
	balanceStatus: TBalanceStatus;
}

export interface IDashboardMealBlock {
	totalMeals: number;
	totalBazar: number;
	mealRate: number;
	me: IDashboardMemberMeal;
}

export interface IDashboardUtilityBlock {
	totalDeposits: number;
	totalPaidBills: number;
	balance: number;
	needsReplenishment: boolean;
}

export interface IDashboardResult {
	month: IMonthContext;
	meal: IDashboardMealBlock;
	utility: IDashboardUtilityBlock;
	/** Managers get the approval queue count; other members get `null`. */
	pendingMemberCount: number | null;
}
