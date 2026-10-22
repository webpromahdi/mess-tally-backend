import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import {
	MemberStatus,
	UtilityCategory,
	UtilitySplitType,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { toMoney } from "../../utils/money";
import { normalizeOptionalText } from "../../utils/text";
import type { IRequestUser } from "../auth/auth.interface";
import { requireActiveMembership } from "../mess/mess.scope";
import {
	assertMonthWritable,
	getOrCreateMonthByDate,
	resolveMonthForRead,
} from "../messMonth/month.service";
import {
	formatDateOnly,
	parseDateOnly,
	parseMonthParam,
	round2,
} from "../messMonth/month.util";
import { calculateUtilityShare } from "./utility.calculator";
import type {
	IDeleteUtilityResult,
	IUtilityBill,
	IUtilityBillResult,
	IUtilityListResult,
} from "./utility.interface";
import type {
	TCreateUtilityPayload,
	TUpdateUtilityPayload,
	TUtilityListQuery,
} from "./utility.validation";

const utilitySelect = {
	id: true,
	messMonthId: true,
	category: true,
	title: true,
	amount: true,
	splitType: true,
	dueDate: true,
	isPaid: true,
	paidAt: true,
	paidById: true,
	notes: true,
	addedById: true,
	createdAt: true,
	updatedAt: true,
	paidBy: { select: { user: { select: { name: true } } } },
	addedBy: { select: { user: { select: { name: true } } } },
} satisfies Prisma.UtilityExpenseSelect;

type TUtilityRow = Prisma.UtilityExpenseGetPayload<{
	select: typeof utilitySelect;
}>;

const toUtilityBill = (row: TUtilityRow): IUtilityBill => ({
	id: row.id,
	messMonthId: row.messMonthId,
	category: row.category,
	title: row.title,
	amount: toMoney(row.amount),
	splitType: row.splitType,
	dueDate: row.dueDate ? formatDateOnly(row.dueDate) : null,
	isPaid: row.isPaid,
	paidAt: row.paidAt,
	paidById: row.paidById,
	paidByName: row.paidBy?.user.name ?? null,
	notes: row.notes,
	addedById: row.addedById,
	addedByName: row.addedBy.user.name,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

/**
 * Utility bills for one month plus U1 (AC 5.1.2, AC 5.1.3). Utility data never
 * touches meal or bazar queries (AC 5.1.4).
 *
 * A month with no row returns `200` with `month.exists = false`, an empty list
 * and a zero share. GET never creates a month.
 */
const listUtilities = async (
	user: IRequestUser,
	query: TUtilityListQuery,
): Promise<IUtilityListResult> => {
	const actor = await requireActiveMembership(user.userId);
	const { range, context } = await resolveMonthForRead(
		actor.messId,
		query.month,
	);

	const [rows, activeMemberCount] = await Promise.all([
		prisma.utilityExpense.findMany({
			where: {
				messMonth: {
					is: { messId: actor.messId, startDate: range.startDate },
				},
			},
			select: utilitySelect,
			orderBy: [{ createdAt: "asc" }],
		}),
		prisma.messMember.count({
			where: { messId: actor.messId, status: MemberStatus.ACTIVE },
		}),
	]);

	let total = 0;
	let paid = 0;

	for (const row of rows) {
		const amount = Number(row.amount);
		total += amount;

		if (row.isPaid) {
			paid += amount;
		}
	}

	const roundedTotal = round2(total);
	const roundedPaid = round2(paid);

	return {
		month: context,
		bills: rows.map(toUtilityBill),
		totals: {
			total: roundedTotal,
			paid: roundedPaid,
			unpaid: round2(roundedTotal - roundedPaid),
			activeMemberCount,
			perPersonShare: calculateUtilityShare(roundedTotal, activeMemberCount),
		},
	};
};

/**
 * Creates an unpaid bill in an explicitly selected month. The month may be
 * auto-created (D1). `addedById` is always the caller; `paymentId` and
 * `receiptUrl` are never accepted.
 */
const createUtility = async (
	user: IRequestUser,
	payload: TCreateUtilityPayload,
): Promise<IUtilityBillResult> => {
	const actor = await requireActiveMembership(user.userId);
	const range = parseMonthParam(payload.month);
	const month = await getOrCreateMonthByDate(
		actor.messId,
		range.startDate,
		actor.isManager ? actor.id : null,
	);
	assertMonthWritable(month);

	const created = await prisma.utilityExpense.create({
		data: {
			messMonthId: month.id,
			category: payload.category ?? UtilityCategory.OTHER,
			title: payload.title.trim(),
			amount: round2(payload.amount),
			splitType: payload.splitType ?? UtilitySplitType.EQUAL,
			dueDate: payload.dueDate ? parseDateOnly(payload.dueDate) : null,
			notes: normalizeOptionalText(payload.notes) ?? null,
			addedById: actor.id,
		},
		select: utilitySelect,
	});

	return { bill: toUtilityBill(created) };
};

/**
 * Partial edit. A bill cannot move between months here; if the month is wrong,
 * delete and recreate it. Payment state changes only through `setUtilityPaid`.
 */
const updateUtility = async (
	user: IRequestUser,
	billId: string,
	payload: TUpdateUtilityPayload,
): Promise<IUtilityBillResult> => {
	const actor = await requireActiveMembership(user.userId);

	const existing = await prisma.utilityExpense.findFirst({
		where: {
			id: billId,
			messMonth: { is: { messId: actor.messId } },
		},
		select: {
			id: true,
			messMonth: { select: { status: true, name: true } },
		},
	});

	if (!existing) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No utility bill found with this id in your mess",
		);
	}

	assertMonthWritable(existing.messMonth);

	const data: Prisma.UtilityExpenseUpdateInput = {};

	if (payload.category !== undefined) {
		data.category = payload.category;
	}

	if (payload.title !== undefined) {
		data.title = payload.title.trim();
	}

	if (payload.amount !== undefined) {
		data.amount = round2(payload.amount);
	}

	if (payload.splitType !== undefined) {
		data.splitType = payload.splitType;
	}

	if (payload.dueDate !== undefined) {
		data.dueDate =
			payload.dueDate === null ? null : parseDateOnly(payload.dueDate);
	}

	const notes = normalizeOptionalText(payload.notes);

	if (notes !== undefined) {
		data.notes = notes;
	}

	const updated = await prisma.utilityExpense.update({
		where: { id: existing.id },
		data,
		select: utilitySelect,
	});

	return { bill: toUtilityBill(updated) };
};

/**
 * Marks a bill paid or unpaid in one place so `paidAt` always matches `isPaid`
 * (the DB CHECK constraint rejects the inconsistent state). The caller is the
 * recorded payer.
 */
const setUtilityPaid = async (
	user: IRequestUser,
	billId: string,
	isPaid: boolean,
): Promise<IUtilityBillResult> => {
	const actor = await requireActiveMembership(user.userId);

	const existing = await prisma.utilityExpense.findFirst({
		where: {
			id: billId,
			messMonth: { is: { messId: actor.messId } },
		},
		select: {
			id: true,
			messMonth: { select: { status: true, name: true } },
		},
	});

	if (!existing) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No utility bill found with this id in your mess",
		);
	}

	assertMonthWritable(existing.messMonth);

	const updated = await prisma.utilityExpense.update({
		where: { id: existing.id },
		data: isPaid
			? {
					isPaid: true,
					paidAt: new Date(),
					paidBy: { connect: { id: actor.id } },
				}
			: {
					isPaid: false,
					paidAt: null,
					paidBy: { disconnect: true },
				},
		select: utilitySelect,
	});

	return { bill: toUtilityBill(updated) };
};

const deleteUtility = async (
	user: IRequestUser,
	billId: string,
): Promise<IDeleteUtilityResult> => {
	const actor = await requireActiveMembership(user.userId);

	const existing = await prisma.utilityExpense.findFirst({
		where: {
			id: billId,
			messMonth: { is: { messId: actor.messId } },
		},
		select: {
			id: true,
			messMonth: { select: { status: true, name: true } },
		},
	});

	if (!existing) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No utility bill found with this id in your mess",
		);
	}

	assertMonthWritable(existing.messMonth);

	await prisma.utilityExpense.delete({ where: { id: existing.id } });

	return { id: existing.id, deleted: true };
};

export const utilityService = {
	listUtilities,
	createUtility,
	updateUtility,
	setUtilityPaid,
	deleteUtility,
};
