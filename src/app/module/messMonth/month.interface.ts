import type { MonthStatus } from "../../../generated/prisma/enums";

/**
 * Wire shape for a month. Dates are `YYYY-MM-DD` strings so the frontend never
 * has to deal with timezone shifts.
 */
export interface IMonthSummary {
	id: string;
	name: string;
	startDate: string;
	endDate: string | null;
	status: MonthStatus;
	managerId: string | null;
	closedAt: Date | null;
	isCurrent: boolean;
}

export interface IMonthListResult {
	months: IMonthSummary[];
	total: number;
}

export interface IOpenMonthResult {
	month: IMonthSummary;
	created: boolean;
}
