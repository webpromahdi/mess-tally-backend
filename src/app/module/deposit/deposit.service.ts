import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import { MemberStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { toMoney } from "../../utils/money";
import { normalizeOptionalText } from "../../utils/text";
import type { IRequestUser } from "../auth/auth.interface";
import type { TActiveMember } from "../mess/mess.interface";
import { assertManager, requireActiveMembership } from "../mess/mess.scope";
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
	IDeleteDepositResult,
	IDepositEntry,
	IDepositEntryResult,
	IDepositListResult,
	IDepositMemberTotal,
} from "./deposit.interface";
import type {
	TCreateDepositPayload,
	TDepositListQuery,
	TUpdateDepositPayload,
} from "./deposit.validation";

const depositSelect = {
	id: true,
	memberId: true,
	messMonthId: true,
	amount: true,
	date: true,
	note: true,
	receivedById: true,
	createdAt: true,
	updatedAt: true,
	member: {
		select: {
			status: true,
			user: { select: { name: true } },
		},
	},
	receivedBy: { select: { user: { select: { name: true } } } },
} satisfies Prisma.DepositSelect;

type TDepositRow = Prisma.DepositGetPayload<{ select: typeof depositSelect }>;

const toDepositEntry = (row: TDepositRow): IDepositEntry => ({
	id: row.id,
	memberId: row.memberId,
	memberName: row.member.user.name,
	memberStatus: row.member.status,
	amount: toMoney(row.amount),
	date: formatDateOnly(row.date),
	note: row.note,
	receivedById: row.receivedById,
	receivedByName: row.receivedBy.user.name,
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
			"Only active members of your mess can make a deposit.",
		);
	}

	return { id: member.id };
};

/**
 * Deposits for one month, visible to every ACTIVE member for transparency
 * (AC 5.2.2 groundwork). GET never creates a month row.
 */
const listDeposits = async (
	user: IRequestUser,
	query: TDepositListQuery,
): Promise<IDepositListResult> => {
	const actor = await requireActiveMembership(user.userId);
	const { range, context } = await resolveMonthForRead(
		actor.messId,
		query.month,
	);

	const rows = await prisma.deposit.findMany({
		where: {
			messMonth: {
				is: { messId: actor.messId, startDate: range.startDate },
			},
		},
		select: depositSelect,
		orderBy: [{ date: "asc" }, { createdAt: "asc" }],
	});

	const byMember = new Map<string, IDepositMemberTotal>();
	let total = 0;

	for (const row of rows) {
		const amount = Number(row.amount);
		total += amount;

		const current = byMember.get(row.memberId);

		if (current) {
			current.count += 1;
			current.amount += amount;
		} else {
			byMember.set(row.memberId, {
				memberId: row.memberId,
				name: row.member.user.name,
				status: row.member.status,
				count: 1,
				amount,
			});
		}
	}

	return {
		month: context,
		deposits: rows.map(toDepositEntry),
		total: round2(total),
		byMember: [...byMember.values()]
			.map((member) => ({ ...member, amount: round2(member.amount) }))
			.sort((a, b) => a.name.localeCompare(b.name)),
	};
};

/**
 * Manager-only deposit entry (D5). The month is derived from `date` and
 * auto-created. `receivedById` is always the caller.
 */
const createDeposit = async (
	user: IRequestUser,
	payload: TCreateDepositPayload,
): Promise<IDepositEntryResult> => {
	const actor = assertManager(await requireActiveMembership(user.userId));
	const date = payload.date
		? parseDateOnly(payload.date)
		: parseDateOnly(formatDateOnly(new Date()));
	const member = await resolveActiveMember(actor, payload.memberId);
	const month = await getOrCreateMonthByDate(actor.messId, date, actor.id);
	assertMonthWritable(month);

	const created = await prisma.deposit.create({
		data: {
			messMonthId: month.id,
			memberId: member.id,
			receivedById: actor.id,
			amount: round2(payload.amount),
			date,
			note: normalizeOptionalText(payload.note) ?? null,
		},
		select: depositSelect,
	});

	return { deposit: toDepositEntry(created) };
};

/**
 * Manager-only partial edit. Moving `date` across a month boundary re-derives
 * `messMonthId`; both months must be writable. `receivedById` is unchanged.
 */
const updateDeposit = async (
	user: IRequestUser,
	depositId: string,
	payload: TUpdateDepositPayload,
): Promise<IDepositEntryResult> => {
	const actor = assertManager(await requireActiveMembership(user.userId));

	const existing = await prisma.deposit.findFirst({
		where: {
			id: depositId,
			messMonth: { is: { messId: actor.messId } },
		},
		select: {
			id: true,
			date: true,
			messMonth: { select: { status: true, name: true } },
		},
	});

	if (!existing) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No deposit found with this id in your mess",
		);
	}

	assertMonthWritable(existing.messMonth);

	const data: Prisma.DepositUncheckedUpdateInput = {};

	if (payload.memberId !== undefined) {
		const member = await resolveActiveMember(actor, payload.memberId);
		data.memberId = member.id;
	}

	if (payload.amount !== undefined) {
		data.amount = round2(payload.amount);
	}

	if (payload.date !== undefined) {
		const date = parseDateOnly(payload.date);
		data.date = date;

		const oldRange = monthRangeFromDate(existing.date);
		const newRange = monthRangeFromDate(date);

		if (oldRange.startDate.getTime() !== newRange.startDate.getTime()) {
			const targetMonth = await getOrCreateMonthByDate(
				actor.messId,
				date,
				actor.id,
			);
			assertMonthWritable(targetMonth);
			data.messMonthId = targetMonth.id;
		}
	}

	const note = normalizeOptionalText(payload.note);

	if (note !== undefined) {
		data.note = note;
	}

	const updated = await prisma.deposit.update({
		where: { id: existing.id },
		data,
		select: depositSelect,
	});

	return { deposit: toDepositEntry(updated) };
};

const deleteDeposit = async (
	user: IRequestUser,
	depositId: string,
): Promise<IDeleteDepositResult> => {
	const actor = assertManager(await requireActiveMembership(user.userId));

	const existing = await prisma.deposit.findFirst({
		where: {
			id: depositId,
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
			"No deposit found with this id in your mess",
		);
	}

	assertMonthWritable(existing.messMonth);

	await prisma.deposit.delete({ where: { id: existing.id } });

	return { id: existing.id, deleted: true };
};

export const depositService = {
	listDeposits,
	createDeposit,
	updateDeposit,
	deleteDeposit,
};
