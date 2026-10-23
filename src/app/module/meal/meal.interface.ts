import type {
	MemberStatus,
	MonthStatus,
} from "../../../generated/prisma/enums";

export interface IMealTotals {
	breakfast: number;
	lunch: number;
	dinner: number;
	guestMeals: number;
	total: number;
}

/** One cell of the dense grid. `entryId` is null when no row exists yet. */
export interface IMealCell {
	date: string;
	entryId: string | null;
	breakfast: number;
	lunch: number;
	dinner: number;
	guestMeals: number;
	total: number;
	isLocked: boolean;
}

export interface IMealGridMember {
	memberId: string;
	name: string;
	avatarUrl: string | null;
	status: MemberStatus;
	days: IMealCell[];
	totals: IMealTotals;
}

export interface IMealGridMonth {
	id: string | null;
	name: string;
	startDate: string;
	endDate: string;
	status: MonthStatus | null;
	exists: boolean;
}

/**
 * Dense grid: every active member (plus LEFT members with data) x every day.
 * The frontend can render it directly without filling gaps.
 */
export interface IMealGridResult {
	month: IMealGridMonth;
	days: string[];
	members: IMealGridMember[];
	houseTotals: IMealTotals;
}

export interface IMealEntryDto {
	id: string;
	messMonthId: string;
	memberId: string;
	date: string;
	breakfast: number;
	lunch: number;
	dinner: number;
	guestMeals: number;
	total: number;
	isLocked: boolean;
	updatedById: string | null;
	updatedAt: Date;
}

export interface IUpsertMealResult {
	entry: IMealEntryDto;
}

export interface IBulkUpsertMealResult {
	entries: IMealEntryDto[];
}

export interface IDeleteMealResult {
	id: string;
	deleted: true;
}
