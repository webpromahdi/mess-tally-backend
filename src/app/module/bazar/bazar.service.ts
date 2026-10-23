import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import { MemberStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { toMoney } from "../../utils/money";
import { normalizeOptionalText } from "../../utils/text";
import type { IRequestUser } from "../auth/auth.interface";
import type { TActiveMember } from "../mess/mess.interface";
import { requireActiveMembership } from "../mess/mess.scope";
import { destroyCloudinaryAsset, uploadImageBuffer } from "../../lib/cloudinary";
import {
	assertMonthWritable,
	getOrCreateMonthByDate,
	resolveMonthForRead,
} from "../messMonth/month.service";
import {
	formatDateOnly,
	monthRangeFromDate,
	parseDateOnly,
	round2,
} from "../messMonth/month.util";
import type {
	IBazarEntry,
	IBazarEntryResult,
	IBazarListResult,
	IBazarShopperTotal,
	IDeleteBazarResult,
} from "./bazar.interface";
import type {
	TBazarListQuery,
	TCreateBazarPayload,
	TUpdateBazarPayload,
} from "./bazar.validation";

const bazarSelect = {
	id: true,
	title: true,
	items: true,
	amount: true,
	bazarDate: true,
	shopperId: true,
	addedById: true,
	paidFromMessFund: true,
	receiptUrl: true,
	receiptPublicId: true,
	createdAt: true,
	updatedAt: true,
	shopper: { select: { user: { select: { name: true } } } },
	addedBy: { select: { user: { select: { name: true } } } },
} satisfies Prisma.MealExpenseSelect;

type TBazarRow = Prisma.MealExpenseGetPayload<{ select: typeof bazarSelect }>;

const toBazarEntry = (row: TBazarRow): IBazarEntry => ({
	id: row.id,
	title: row.title,
	items: row.items,
	amount: toMoney(row.amount),
	bazarDate: formatDateOnly(row.bazarDate),
	shopperId: row.shopperId,
	shopperName: row.shopper.user.name,
	addedById: row.addedById,
	addedByName: row.addedBy.user.name,
	paidFromMessFund: row.paidFromMessFund,
	receiptUrl: row.receiptUrl,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

/** Cross-mess ids return 404; non-active members in the mess return 409. */
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
			"Only active members of your mess can be selected as the shopper.",
		);
	}

	return { id: member.id };
};

/**
 * Chronological bazar list for one month, with per-shopper and house totals
 * (AC 4.1.2). `from`/`to` narrow the selected month; a month with no row still
 * returns `200` with `month.exists = false` and zero totals.
 */
const listBazar = async (
	user: IRequestUser,
	query: TBazarListQuery,
): Promise<IBazarListResult> => {
	const actor = await requireActiveMembership(user.userId);
	const { range, context } = await resolveMonthForRead(
		actor.messId,
		query.month,
	);

	const from = query.from ? parseDateOnly(query.from) : range.startDate;
	const to = query.to ? parseDateOnly(query.to) : range.endDate;

	if (from.getTime() < range.startDate.getTime()) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"`from` must be within the selected month.",
		);
	}

	if (to.getTime() > range.endDate.getTime()) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"`to` must be within the selected month.",
		);
	}

	if (from.getTime() > to.getTime()) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"`from` must be on or before `to`.",
		);
	}

	const rows = await prisma.mealExpense.findMany({
		where: {
			messMonth: { is: { messId: actor.messId } },
			bazarDate: { gte: from, lte: to },
			...(query.shopperId ? { shopperId: query.shopperId } : {}),
		},
		select: bazarSelect,
		orderBy: [{ bazarDate: "asc" }, { createdAt: "asc" }],
	});

	const byShopper = new Map<string, IBazarShopperTotal>();
	let houseTotal = 0;

	for (const row of rows) {
		const amount = Number(row.amount);
		houseTotal += amount;

		const current = byShopper.get(row.shopperId);

		if (current) {
			current.count += 1;
			current.amount += amount;
		} else {
			byShopper.set(row.shopperId, {
				memberId: row.shopperId,
				name: row.shopper.user.name,
				count: 1,
				amount,
			});
		}
	}

	return {
		month: context,
		entries: rows.map(toBazarEntry),
		totals: {
			houseTotal: round2(houseTotal),
			byShopper: [...byShopper.values()]
				.map((total) => ({ ...total, amount: round2(total.amount) }))
				.sort((a, b) => a.name.localeCompare(b.name)),
		},
	};
};

/**
 * Records a bazar trip. The month is derived from `bazarDate` and auto-created
 * (D1). `addedById` is always the caller and `paidFromMessFund` stays false
 * (D11); neither is accepted from the client.
 */
const createBazar = async (
	user: IRequestUser,
	payload: TCreateBazarPayload,
): Promise<IBazarEntryResult> => {
	const actor = await requireActiveMembership(user.userId);
	const bazarDate = parseDateOnly(payload.bazarDate);
	const shopper = await resolveActiveMember(actor, payload.shopperId);
	const month = await getOrCreateMonthByDate(
		actor.messId,
		bazarDate,
		actor.isManager ? actor.id : null,
	);
	assertMonthWritable(month);

	const created = await prisma.mealExpense.create({
		data: {
			messMonthId: month.id,
			title: payload.title?.trim() || "Bazar",
			items: normalizeOptionalText(payload.items) ?? null,
			amount: round2(payload.amount),
			bazarDate,
			shopperId: shopper.id,
			addedById: actor.id,
			paidFromMessFund: false,
		},
		select: bazarSelect,
	});

	return { entry: toBazarEntry(created) };
};

/**
 * Partial update. Moving `bazarDate` across a month boundary re-derives
 * `messMonthId`, so both the old and target months must be writable.
 */
const updateBazar = async (
	user: IRequestUser,
	bazarId: string,
	payload: TUpdateBazarPayload,
): Promise<IBazarEntryResult> => {
	const actor = await requireActiveMembership(user.userId);

	const existing = await prisma.mealExpense.findFirst({
		where: {
			id: bazarId,
			messMonth: { is: { messId: actor.messId } },
		},
		select: {
			id: true,
			bazarDate: true,
			messMonth: { select: { status: true, name: true } },
		},
	});

	if (!existing) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No bazar entry found with this id in your mess",
		);
	}

	assertMonthWritable(existing.messMonth);

	const data: Prisma.MealExpenseUpdateInput = {};

	if (payload.title !== undefined) {
		data.title = payload.title.trim() || "Bazar";
	}

	const items = normalizeOptionalText(payload.items);

	if (items !== undefined) {
		data.items = items;
	}

	if (payload.amount !== undefined) {
		data.amount = round2(payload.amount);
	}

	if (payload.shopperId !== undefined) {
		const shopper = await resolveActiveMember(actor, payload.shopperId);
		data.shopper = { connect: { id: shopper.id } };
	}

	if (payload.bazarDate !== undefined) {
		const bazarDate = parseDateOnly(payload.bazarDate);
		data.bazarDate = bazarDate;

		const oldRange = monthRangeFromDate(existing.bazarDate);
		const newRange = monthRangeFromDate(bazarDate);

		if (oldRange.startDate.getTime() !== newRange.startDate.getTime()) {
			const targetMonth = await getOrCreateMonthByDate(
				actor.messId,
				bazarDate,
				actor.isManager ? actor.id : null,
			);
			assertMonthWritable(targetMonth);
			data.messMonth = { connect: { id: targetMonth.id } };
		}
	}

	const updated = await prisma.mealExpense.update({
		where: { id: existing.id },
		data,
		select: bazarSelect,
	});

	return { entry: toBazarEntry(updated) };
};

const deleteBazar = async (
	user: IRequestUser,
	bazarId: string,
): Promise<IDeleteBazarResult> => {
	const actor = await requireActiveMembership(user.userId);

	const existing = await prisma.mealExpense.findFirst({
		where: {
			id: bazarId,
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
			"No bazar entry found with this id in your mess",
		);
	}

	assertMonthWritable(existing.messMonth);

	await prisma.mealExpense.delete({ where: { id: existing.id } });

	return { id: existing.id, deleted: true };
};

const uploadReceipt = async (
	user: IRequestUser,
	bazarId: string,
	file: Express.Multer.File | undefined,
): Promise<IBazarEntryResult> => {
	const actor = await requireActiveMembership(user.userId);
	if (!file) {
		throw new AppError(httpStatus.BAD_REQUEST, "Receipt image is required.");
	}
	const existing = await prisma.mealExpense.findFirst({
		where: { id: bazarId, messMonth: { is: { messId: actor.messId } } },
		select: {
			id: true,
			receiptPublicId: true,
			messMonth: { select: { status: true, name: true } },
		},
	});
	if (!existing) {
		throw new AppError(httpStatus.NOT_FOUND, "No bazar entry found with this id in your mess");
	}
	assertMonthWritable(existing.messMonth);
	const uploaded = await uploadImageBuffer(file.buffer, `mess-tally/${actor.messId}/receipts`);
	const updated = await prisma.mealExpense.update({
		where: { id: existing.id },
		data: { receiptUrl: uploaded.secure_url, receiptPublicId: uploaded.public_id },
		select: bazarSelect,
	});
	await destroyCloudinaryAsset(existing.receiptPublicId);
	return { entry: toBazarEntry(updated) };
};

const deleteReceipt = async (
	user: IRequestUser,
	bazarId: string,
): Promise<IBazarEntryResult> => {
	const actor = await requireActiveMembership(user.userId);
	const existing = await prisma.mealExpense.findFirst({
		where: { id: bazarId, messMonth: { is: { messId: actor.messId } } },
		select: {
			id: true,
			receiptPublicId: true,
			messMonth: { select: { status: true, name: true } },
		},
	});
	if (!existing) {
		throw new AppError(httpStatus.NOT_FOUND, "No bazar entry found with this id in your mess");
	}
	assertMonthWritable(existing.messMonth);
	const updated = await prisma.mealExpense.update({
		where: { id: existing.id },
		data: { receiptUrl: null, receiptPublicId: null },
		select: bazarSelect,
	});
	await destroyCloudinaryAsset(existing.receiptPublicId);
	return { entry: toBazarEntry(updated) };
};

export const bazarService = {
	listBazar,
	createBazar,
	updateBazar,
	deleteBazar,
	uploadReceipt,
	deleteReceipt,
};
