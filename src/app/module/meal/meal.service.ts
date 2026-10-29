import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import { MemberStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { IRequestUser } from "../auth/auth.interface";
import type { TActiveMember } from "../mess/mess.interface";
import { assertManager, requireActiveMembership } from "../mess/mess.scope";
import { assertProAccess } from "../subscription/plan";
import config from "../../config";
import { dateOnlyInTimeZone, isPastCutoff } from "../../utils/time";
import {
	assertMonthWritable,
	getMonthByDate,
	getOrCreateMonthByDate,
	resolveMonthForRead,
} from "../messMonth/month.service";
import {
	formatDateOnly,
	listMonthDays,
	monthRangeFromDate,
	parseDateOnly,
	round2,
} from "../messMonth/month.util";
import type {
	IBulkUpsertMealResult,
	IDeleteMealResult,
	IMealCell,
	IMealEntryDto,
	IMealGridResult,
	IMealTotals,
	IUpsertMealResult,
} from "./meal.interface";
import type {
	TBulkUpsertMealPayload,
	TSelfMealPayload,
	TUpsertMealPayload,
} from "./meal.validation";

const entrySelect = {
	id: true,
	messMonthId: true,
	memberId: true,
	date: true,
	breakfast: true,
	lunch: true,
	dinner: true,
	guestMeals: true,
	isLocked: true,
	updatedById: true,
	updatedAt: true,
} satisfies Prisma.MealEntrySelect;

type TEntryRow = Prisma.MealEntryGetPayload<{ select: typeof entrySelect }>;

const gridMemberSelect = {
	id: true,
	status: true,
	joinedAt: true,
	user: {
		select: {
			name: true,
			profile: { select: { imageUrl: true } },
		},
	},
} satisfies Prisma.MessMemberSelect;

type TGridMemberRow = Prisma.MessMemberGetPayload<{
	select: typeof gridMemberSelect;
}>;

const emptyTotals = (): IMealTotals => ({
	breakfast: 0,
	lunch: 0,
	dinner: 0,
	guestMeals: 0,
	total: 0,
});

const finalizeTotals = (totals: IMealTotals): IMealTotals => ({
	breakfast: round2(totals.breakfast),
	lunch: round2(totals.lunch),
	dinner: round2(totals.dinner),
	guestMeals: round2(totals.guestMeals),
	total: round2(totals.total),
});

const mealTotal = (
	breakfast: number,
	lunch: number,
	dinner: number,
	guestMeals: number,
) => breakfast + lunch + dinner + guestMeals;

const toEntryDto = (entry: TEntryRow): IMealEntryDto => ({
	id: entry.id,
	messMonthId: entry.messMonthId,
	memberId: entry.memberId,
	date: formatDateOnly(entry.date),
	breakfast: entry.breakfast,
	lunch: entry.lunch,
	dinner: entry.dinner,
	guestMeals: entry.guestMeals,
	total: round2(
		mealTotal(entry.breakfast, entry.lunch, entry.dinner, entry.guestMeals),
	),
	isLocked: entry.isLocked,
	updatedById: entry.updatedById,
	updatedAt: entry.updatedAt,
});

/**
 * Scoping by both id and mess means a cross-mess member id returns 404 instead
 * of leaking that the member exists in another mess.
 */
const resolveActiveMember = async (
	actor: TActiveMember,
	memberId: string,
): Promise<{ id: string }> => {
	const member = await prisma.messMember.findFirst({
		where: { id: memberId, messId: actor.messId },
		select: { id: true, status: true },
	});

	if (!member) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No member found with this id in your mess",
		);
	}

	if (member.status !== MemberStatus.ACTIVE) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Only active members of your mess can be assigned meals.",
		);
	}

	return { id: member.id };
};

const statusRank: Record<MemberStatus, number> = {
	[MemberStatus.ACTIVE]: 0,
	[MemberStatus.PENDING]: 1,
	[MemberStatus.LEFT]: 2,
	[MemberStatus.REJECTED]: 3,
};

const buildGridMember = (
	row: TGridMemberRow,
	days: string[],
	entryMap: Map<string, IMealCell>,
	houseTotals: IMealTotals,
) => {
	const totals = emptyTotals();

	const cells = days.map((day) => {
		const cell = entryMap.get(`${row.id}|${day}`);

		if (!cell) {
			return {
				date: day,
				entryId: null,
				breakfast: 0,
				lunch: 0,
				dinner: 0,
				guestMeals: 0,
				total: 0,
				isLocked: false,
			} satisfies IMealCell;
		}

		totals.breakfast += cell.breakfast;
		totals.lunch += cell.lunch;
		totals.dinner += cell.dinner;
		totals.guestMeals += cell.guestMeals;

		// Accumulate the raw cell total so the house total does not inherit the
		// per-cell display rounding.
		const cellTotal = mealTotal(
			cell.breakfast,
			cell.lunch,
			cell.dinner,
			cell.guestMeals,
		);
		totals.total += cellTotal;
		houseTotals.total += cellTotal;

		houseTotals.breakfast += cell.breakfast;
		houseTotals.lunch += cell.lunch;
		houseTotals.dinner += cell.dinner;
		houseTotals.guestMeals += cell.guestMeals;

		return cell;
	});

	return {
		memberId: row.id,
		name: row.user.name,
		avatarUrl: row.user.profile?.imageUrl || null,
		status: row.status,
		days: cells,
		totals: finalizeTotals(totals),
	};
};

/**
 * Dense grid for one month (AC 3.1.1).
 *
 * A GET never creates a `mess_month` row: a month with no activity still
 * returns a zero-filled grid with `month.exists = false`.
 *
 * Active members are always included. LEFT members are included only when they
 * have entries in this month, so historical data stays visible after someone
 * leaves; they are read-only because every write requires ACTIVE.
 */
const getMealGrid = async (
	user: IRequestUser,
	monthParam?: string,
): Promise<IMealGridResult> => {
	const actor = await requireActiveMembership(user.userId);
	const { range } = await resolveMonthForRead(actor.messId, monthParam);

	const month = await getMonthByDate(actor.messId, range.startDate);

	// Two queries total: entries for the month, then members. No per-cell or
	// per-member queries (avoid N+1).
	const entries = await prisma.mealEntry.findMany({
		where: {
			member: { is: { messId: actor.messId } },
			date: { gte: range.startDate, lt: range.nextMonthStart },
		},
		select: entrySelect,
		orderBy: [{ memberId: "asc" }, { date: "asc" }],
	});

	const entryMemberIds = [...new Set(entries.map((entry) => entry.memberId))];

	const memberRows = await prisma.messMember.findMany({
		where: {
			messId: actor.messId,
			OR: [
				{ status: MemberStatus.ACTIVE },
				...(entryMemberIds.length ? [{ id: { in: entryMemberIds } }] : []),
			],
		},
		select: gridMemberSelect,
	});

	memberRows.sort((a, b) => {
		const byStatus = statusRank[a.status] - statusRank[b.status];

		if (byStatus !== 0) {
			return byStatus;
		}

		return a.joinedAt.getTime() - b.joinedAt.getTime();
	});

	const days = listMonthDays(range);
	const entryMap = new Map<string, IMealCell>();

	for (const entry of entries) {
		const totals = mealTotal(
			entry.breakfast,
			entry.lunch,
			entry.dinner,
			entry.guestMeals,
		);

		entryMap.set(`${entry.memberId}|${formatDateOnly(entry.date)}`, {
			date: formatDateOnly(entry.date),
			entryId: entry.id,
			breakfast: entry.breakfast,
			lunch: entry.lunch,
			dinner: entry.dinner,
			guestMeals: entry.guestMeals,
			total: round2(totals),
			isLocked: entry.isLocked,
		});
	}

	const houseTotals = emptyTotals();
	const members = memberRows.map((row) =>
		buildGridMember(row, days, entryMap, houseTotals),
	);

	return {
		month: {
			id: month?.id ?? null,
			name: range.name,
			startDate: formatDateOnly(range.startDate),
			endDate: formatDateOnly(range.endDate),
			status: month?.status ?? null,
			exists: Boolean(month),
		},
		days,
		members,
		houseTotals: finalizeTotals(houseTotals),
	};
};

/**
 * Single-cell upsert (AC 3.1.2, AC 3.1.5).
 *
 * The month is derived from `date`, auto-created on demand, and checked for
 * CLOSED status before writing. Idempotent: the same payload twice leaves one
 * row.
 */
const upsertMeal = async (
	user: IRequestUser,
	payload: TUpsertMealPayload,
): Promise<IUpsertMealResult> => {
	const actor = await requireActiveMembership(user.userId);
	assertManager(actor);
	const date = parseDateOnly(payload.date);
	const member = await resolveActiveMember(actor, payload.memberId);

	const month = await getOrCreateMonthByDate(
		actor.messId,
		date,
		actor.isManager ? actor.id : null,
	);
	assertMonthWritable(month);

	const existing = await prisma.mealEntry.findUnique({
		where: {
			messMonthId_memberId_date: {
				messMonthId: month.id,
				memberId: member.id,
				date,
			},
		},
		select: { isLocked: true },
	});

	if (existing?.isLocked) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This meal entry is locked and cannot be changed.",
		);
	}

	const entry = await prisma.mealEntry.upsert({
		where: {
			messMonthId_memberId_date: {
				messMonthId: month.id,
				memberId: member.id,
				date,
			},
		},
		create: {
			messMonthId: month.id,
			memberId: member.id,
			date,
			breakfast: payload.breakfast,
			lunch: payload.lunch,
			dinner: payload.dinner,
			guestMeals: payload.guestMeals,
			updatedById: actor.id,
		},
		update: {
			breakfast: payload.breakfast,
			lunch: payload.lunch,
			dinner: payload.dinner,
			guestMeals: payload.guestMeals,
			updatedById: actor.id,
		},
		select: entrySelect,
	});

	return { entry: toEntryDto(entry) };
};

/**
 * Daily-sheet bulk upsert in one transaction (AC 3.1.2). Any invalid member,
 * CLOSED month or locked existing cell rejects the whole batch.
 */
const bulkUpsertMeals = async (
	user: IRequestUser,
	payload: TBulkUpsertMealPayload,
): Promise<IBulkUpsertMealResult> => {
	const actor = await requireActiveMembership(user.userId);
	assertManager(actor);
	const date = parseDateOnly(payload.date);
	const memberIds = payload.entries.map((entry) => entry.memberId);

	const month = await getOrCreateMonthByDate(
		actor.messId,
		date,
		actor.isManager ? actor.id : null,
	);
	assertMonthWritable(month);

	const members = await prisma.messMember.findMany({
		where: { id: { in: memberIds }, messId: actor.messId },
		select: { id: true, status: true },
	});

	if (members.length !== memberIds.length) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"One or more members do not belong to your mess",
		);
	}

	if (members.some((member) => member.status !== MemberStatus.ACTIVE)) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Only active members of your mess can be assigned meals.",
		);
	}

	const lockedEntry = await prisma.mealEntry.findFirst({
		where: {
			messMonthId: month.id,
			date,
			memberId: { in: memberIds },
			isLocked: true,
		},
		select: { memberId: true },
	});

	if (lockedEntry) {
		throw new AppError(
			httpStatus.CONFLICT,
			"One or more meal entries are locked and cannot be changed.",
		);
	}

	const rows = await prisma.$transaction(
		payload.entries.map((entry) =>
			prisma.mealEntry.upsert({
				where: {
					messMonthId_memberId_date: {
						messMonthId: month.id,
						memberId: entry.memberId,
						date,
					},
				},
				create: {
					messMonthId: month.id,
					memberId: entry.memberId,
					date,
					breakfast: entry.breakfast,
					lunch: entry.lunch,
					dinner: entry.dinner,
					guestMeals: entry.guestMeals,
					updatedById: actor.id,
				},
				update: {
					breakfast: entry.breakfast,
					lunch: entry.lunch,
					dinner: entry.dinner,
					guestMeals: entry.guestMeals,
					updatedById: actor.id,
				},
				select: entrySelect,
			}),
		),
	);

	return { entries: rows.map(toEntryDto) };
};

const deleteMeal = async (
	user: IRequestUser,
	entryId: string,
): Promise<IDeleteMealResult> => {
	const actor = await requireActiveMembership(user.userId);
	assertManager(actor);

	const entry = await prisma.mealEntry.findFirst({
		where: {
			id: entryId,
			member: { is: { messId: actor.messId } },
		},
		select: {
			id: true,
			isLocked: true,
			messMonth: { select: { status: true, name: true } },
		},
	});

	if (!entry) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No meal entry found with this id in your mess",
		);
	}

	if (entry.isLocked) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This meal entry is locked and cannot be changed.",
		);
	}

	assertMonthWritable(entry.messMonth);

	await prisma.mealEntry.delete({ where: { id: entry.id } });

	return { id: entry.id, deleted: true };
};

const updateOwnMeal = async (
	user: IRequestUser,
	payload: TSelfMealPayload,
): Promise<IUpsertMealResult> => {
	const actor = await requireActiveMembership(user.userId);
	assertProAccess(actor.mess, "Self-service meals");

	if (payload.date !== dateOnlyInTimeZone(new Date(), config.app_timezone)) {
		throw new AppError(httpStatus.BAD_REQUEST, "Self-service meals are limited to today.");
	}

	if (isPastCutoff(actor.mess.mealCutoffTime, config.app_timezone)) {
		throw new AppError(httpStatus.CONFLICT, "Today's meal cutoff has passed.");
	}

	const date = parseDateOnly(payload.date);
	const month = await getOrCreateMonthByDate(actor.messId, date, actor.id);
	assertMonthWritable(month);
	const existing = await prisma.mealEntry.findUnique({
		where: { messMonthId_memberId_date: { messMonthId: month.id, memberId: actor.id, date } },
		select: { isLocked: true },
	});

	if (existing?.isLocked) {
		throw new AppError(httpStatus.CONFLICT, "This meal entry is locked and cannot be changed.");
	}

	const entry = await prisma.mealEntry.upsert({
		where: { messMonthId_memberId_date: { messMonthId: month.id, memberId: actor.id, date } },
		create: {
			messMonthId: month.id,
			memberId: actor.id,
			date,
			breakfast: payload.breakfast ?? 0,
			lunch: payload.lunch ?? 0,
			dinner: payload.dinner ?? 0,
			guestMeals: payload.guestMeals ?? 0,
			updatedById: actor.id,
		},
		update: {
			...(payload.breakfast === undefined ? {} : { breakfast: payload.breakfast }),
			...(payload.lunch === undefined ? {} : { lunch: payload.lunch }),
			...(payload.dinner === undefined ? {} : { dinner: payload.dinner }),
			...(payload.guestMeals === undefined ? {} : { guestMeals: payload.guestMeals }),
			updatedById: actor.id,
		},
		select: entrySelect,
	});

	return { entry: toEntryDto(entry) };
};

export const mealService = {
	getMealGrid,
	upsertMeal,
	bulkUpsertMeals,
	deleteMeal,
	updateOwnMeal,
};
