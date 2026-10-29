import type { MonthStatus } from "../../../generated/prisma/enums";
import type { IMonthRange } from "./month.util";

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

export interface IMonthLockResult {
	month: IMonthSummary;
}

/**
 * Shared month header returned by bazar, utilities and deposits. `id` is null
 * and `exists` false when the month has no row yet.
 */
export interface IMonthContext {
	id: string | null;
	name: string;
	startDate: string;
	endDate: string;
	status: MonthStatus | null;
	exists: boolean;
}

/** Range plus wire context resolved for a read-only month query. */
export interface IMonthReadContext {
	range: IMonthRange;
	context: IMonthContext;
}
