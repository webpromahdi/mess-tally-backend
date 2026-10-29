import httpStatus from "http-status";
import { Prisma, type MessMonth } from "../../../generated/prisma/client";
import { MonthStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { IRequestUser } from "../auth/auth.interface";
import { assertManager, requireActiveMembership } from "../mess/mess.scope";
import { isProActive } from "../subscription/plan";
import config from "../../config";
import { currentMonthName } from "../../utils/time";
import type {
	IMonthContext,
	IMonthListResult,
	IMonthReadContext,
	IMonthSummary,
	IOpenMonthResult,
} from "./month.interface";
import {
	formatDateOnly,
	monthRangeFromDate,
	parseMonthParam,
	type IMonthRange,
} from "./month.util";

export const monthSelect = {
	id: true,
	name: true,
	startDate: true,
	endDate: true,
	status: true,
	managerId: true,
	closedAt: true,
} satisfies Prisma.MessMonthSelect;

export type TMonthRow = Prisma.MessMonthGetPayload<{
	select: typeof monthSelect;
}>;

export const toMonthSummary = (row: TMonthRow): IMonthSummary => ({
	id: row.id,
	name: row.name,
	startDate: formatDateOnly(row.startDate),
	endDate: row.endDate ? formatDateOnly(row.endDate) : null,
	status: row.status,
	managerId: row.managerId,
	closedAt: row.closedAt,
	isCurrent: row.name === monthRangeFromDate(new Date()).name,
});

const toMonthContext = (
	range: IMonthRange,
	month: MessMonth | null,
): IMonthContext => ({
	id: month?.id ?? null,
	name: range.name,
	startDate: formatDateOnly(range.startDate),
	endDate: formatDateOnly(range.endDate),
	status: month?.status ?? null,
	exists: Boolean(month),
});

const isUniqueViolation = (error: unknown): boolean =>
	error instanceof Prisma.PrismaClientKnownRequestError &&
	error.code === "P2002";

const findMonthByStart = (messId: string, startDate: Date) =>
	prisma.messMonth.findUnique({
		where: { messId_startDate: { messId, startDate } },
		select: monthSelect,
	});

/**
 * The month container every meal/bazar/utility row belongs to (decision D1).
 *
 * Callers pass a date-only value; the month is derived from it in UTC and
 * created on first use. Creation is race-safe: the compound unique key makes
 * two concurrent first-writes converge on one row (P2002 is re-read).
 *
 * Dev B imports this for bazar and utilities. It deliberately does NOT assert
 * that the month is writable, because reads may still target a CLOSED month.
 * Call `assertMonthWritable` after this on any write path.
 */
export const getOrCreateMonthByDate = async (
	messId: string,
	date: Date,
	managerId: string | null = null,
): Promise<MessMonth> => {
	const range = monthRangeFromDate(date);
	const where = {
		messId_startDate: { messId, startDate: range.startDate },
	};

	// Read first so a write against a CLOSED month never touches the month row
	// (the caller's `assertMonthWritable` still owns the 409).
	const existing = await prisma.messMonth.findUnique({ where });

	if (existing) {
		if (existing.endDate) {
			return existing;
		}

		// Repair legacy rows whose end date was never filled in.
		return prisma.messMonth.update({
			where: { id: existing.id },
			data: { endDate: range.endDate },
		});
	}

	try {
		return await prisma.messMonth.create({
			data: {
				messId,
				name: range.name,
				startDate: range.startDate,
				endDate: range.endDate,
				managerId,
			},
		});
	} catch (error) {
		// Two concurrent first-writes converge on the winner's row.
		if (isUniqueViolation(error)) {
			const raced = await prisma.messMonth.findUnique({ where });

			if (raced) {
				return raced;
			}
		}

		throw error;
	}
};

/** Read-only month lookup. Returns `null` instead of creating anything. */
export const getMonthByDate = (
	messId: string,
	date: Date,
): Promise<MessMonth | null> => {
	const range = monthRangeFromDate(date);

	return prisma.messMonth.findUnique({
		where: { messId_startDate: { messId, startDate: range.startDate } },
	});
};

/**
 * Resolves `?month=YYYY-MM` for a GET. Defaults to the current UTC month and
 * never creates a row, so a quiet month still renders with zero totals.
 */
export const resolveMonthForRead = async (
	messId: string,
	monthParam?: string,
): Promise<IMonthReadContext> => {
	const range = monthParam
		? parseMonthParam(monthParam)
		: monthRangeFromDate(new Date());
	const month = await getMonthByDate(messId, range.startDate);
	const mess = await prisma.mess.findUnique({
		where: { id: messId },
		select: { plan: true, planExpiresAt: true },
	});

	if (!mess) {
		throw new AppError(httpStatus.NOT_FOUND, "Mess not found.");
	}

	if (!isProActive(mess) && range.name !== currentMonthName(config.app_timezone)) {
		throw new AppError(
			httpStatus.PAYMENT_REQUIRED,
			"Past month archives require an active PRO subscription.",
		);
	}

	return { range, context: toMonthContext(range, month) };
};

/**
 * Decision D2: a CLOSED month is read-only until a manager reopens it
 * (Phase 4). Every write path must call this with the row's status.
 */
export const assertMonthWritable = (
	month: Pick<MessMonth, "status" | "name">,
): void => {
	if (month.status === MonthStatus.CLOSED) {
		throw new AppError(
			httpStatus.CONFLICT,
			`This month (${month.name}) is closed. Reopen it before making changes.`,
		);
	}
};

const listMonths = async (user: IRequestUser): Promise<IMonthListResult> => {
	const actor = await requireActiveMembership(user.userId);

	const rows = await prisma.messMonth.findMany({
		where: { messId: actor.messId },
		select: monthSelect,
		orderBy: { startDate: "desc" },
	});
	const visibleRows = isProActive(actor.mess)
		? rows
		: rows.filter((row) => row.name === currentMonthName(config.app_timezone));

	return {
		months: visibleRows.map(toMonthSummary),
		total: visibleRows.length,
	};
};

/**
 * Manager-only explicit month open. Opening an already ACTIVE month is
 * idempotent (`created: false`); a CLOSED month is a 409 because reopening is
 * a separate Phase 4 action.
 */
const openMonth = async (
	user: IRequestUser,
	monthParam: string,
): Promise<IOpenMonthResult> => {
	const actor = assertManager(await requireActiveMembership(user.userId));
	const range = parseMonthParam(monthParam);
	const existing = await findMonthByStart(actor.messId, range.startDate);

	const toResult = (row: TMonthRow, created: boolean): IOpenMonthResult => {
		if (row.status === MonthStatus.CLOSED) {
			throw new AppError(
				httpStatus.CONFLICT,
				`This month (${row.name}) is already closed. Reopen it before making changes.`,
			);
		}

		return { month: toMonthSummary(row), created };
	};

	if (existing) {
		return toResult(existing, false);
	}

	try {
		const created = await prisma.messMonth.create({
			data: {
				messId: actor.messId,
				name: range.name,
				startDate: range.startDate,
				endDate: range.endDate,
				managerId: actor.id,
			},
			select: monthSelect,
		});

		return { month: toMonthSummary(created), created: true };
	} catch (error) {
		// Two managers opening the same month at once: return the winner.
		if (isUniqueViolation(error)) {
			const raced = await findMonthByStart(actor.messId, range.startDate);

			if (raced) {
				return toResult(raced, false);
			}
		}

		throw error;
	}
};

export const monthService = {
	listMonths,
	openMonth,
};
