import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { MonthStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { IRequestUser } from "../auth/auth.interface";
import { assertManager, requireActiveMembership } from "../mess/mess.scope";
import type { IMonthContext, IMonthLockResult } from "./month.interface";
import { formatDateOnly, monthRangeFromDate } from "./month.util";
import { monthSelect, toMonthSummary, type TMonthRow } from "./month.service";
import type {
	ILockedMonthSnapshot,
	ISummaryResult,
} from "../summary/summary.interface";
import { summaryService } from "../summary/summary.service";
import { utilityService } from "../utility/utility.service";

const MAX_TRANSACTION_ATTEMPTS = 2;

const isTransactionConflict = (error: unknown): boolean =>
	error instanceof Prisma.PrismaClientKnownRequestError &&
	error.code === "P2034";

const runSerializable = async <T>(
	fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> => {
	for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
		try {
			return await prisma.$transaction(fn, {
				isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
			});
		} catch (error) {
			if (!isTransactionConflict(error)) {
				throw error;
			}

			if (attempt === MAX_TRANSACTION_ATTEMPTS) {
				throw new AppError(
					httpStatus.CONFLICT,
					"The month changed while finalizing it. Please retry.",
				);
			}
		}
	}

	// The loop either returns or throws; this keeps TypeScript exhaustive.
	throw new AppError(
		httpStatus.CONFLICT,
		"The month changed while finalizing it. Please retry.",
	);
};

const toMonthContext = (month: TMonthRow): IMonthContext => {
	const range = monthRangeFromDate(month.startDate);

	return {
		id: month.id,
		name: month.name,
		startDate: formatDateOnly(range.startDate),
		endDate: formatDateOnly(range.endDate),
		status: month.status,
		exists: true,
	};
};

const findMonthInTransaction = async (
	tx: Prisma.TransactionClient,
	messId: string,
	monthId: string,
): Promise<TMonthRow> => {
	const month = await tx.messMonth.findFirst({
		where: { id: monthId, messId },
		select: monthSelect,
	});

	if (!month) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No month found with this id in your mess",
		);
	}

	return month;
};

/**
 * Finalizes a month in one serializable transaction: the snapshot, audit
 * columns, status, and meal locks all commit together.
 */
const closeMonth = async (
	user: IRequestUser,
	monthId: string,
): Promise<IMonthLockResult> => {
	const actor = assertManager(await requireActiveMembership(user.userId));

	return runSerializable(async (tx) => {
		const month = await findMonthInTransaction(tx, actor.messId, monthId);

		if (month.status === MonthStatus.CLOSED) {
			throw new AppError(
				httpStatus.CONFLICT,
				`This month (${month.name}) is already closed.`,
			);
		}

		const context = toMonthContext(month);
		const summary = await summaryService.buildSummaryForMonth(
			actor,
			context,
			tx,
		);
		const utility = await utilityService.buildUtilitySnapshot(
			actor.messId,
			month.id,
			tx,
		);
		const closedAt = new Date();
		const lockedSummary: ISummaryResult = {
			...summary,
			month: { ...context, status: MonthStatus.CLOSED },
			isLocked: true,
		};
		const snapshot: ILockedMonthSnapshot = {
			version: 1,
			closedAt: closedAt.toISOString(),
			summary: lockedSummary,
			utility,
		};

		const updated = await tx.messMonth.update({
			where: { id: month.id },
			data: {
				status: MonthStatus.CLOSED,
				closedAt,
				closedById: actor.id,
				lockedMealRate: summary.totals.mealRate,
				lockedTotalMeals: summary.totals.totalMeals,
				lockedTotalBazar: summary.totals.totalBazar,
				lockedTotalUtilities: utility.totalBills,
				lockedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
			},
			select: monthSelect,
		});

		// Lock every cell, including rows belonging to members who have since
		// left, so a later reopen is a single deterministic unlock.
		await tx.mealEntry.updateMany({
			where: { messMonthId: month.id },
			data: { isLocked: true },
		});

		return {
			month: toMonthSummary(updated),
		};
	});
};

/**
 * Clears the snapshot and all audit/lock fields, then unlocks every meal cell.
 * The operation is transactional so the month can never be ACTIVE with stale
 * meal locks.
 */
const reopenMonth = async (
	user: IRequestUser,
	monthId: string,
): Promise<IMonthLockResult> => {
	const actor = assertManager(await requireActiveMembership(user.userId));

	return runSerializable(async (tx) => {
		const month = await findMonthInTransaction(tx, actor.messId, monthId);

		if (month.status === MonthStatus.ACTIVE) {
			throw new AppError(
				httpStatus.CONFLICT,
				`This month (${month.name}) is already active.`,
			);
		}

		const updated = await tx.messMonth.update({
			where: { id: month.id },
			data: {
				status: MonthStatus.ACTIVE,
				closedAt: null,
				closedById: null,
				lockedMealRate: null,
				lockedTotalMeals: null,
				lockedTotalBazar: null,
				lockedTotalUtilities: null,
				lockedSnapshot: Prisma.DbNull,
			},
			select: monthSelect,
		});

		await tx.mealEntry.updateMany({
			where: { messMonthId: month.id },
			data: { isLocked: false },
		});

		return {
			month: toMonthSummary(updated),
		};
	});
};

export const monthFinalizeService = {
	closeMonth,
	reopenMonth,
};
