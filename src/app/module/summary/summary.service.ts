import type { Prisma } from "../../../generated/prisma/client";
import { MemberStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import type { IRequestUser } from "../auth/auth.interface";
import { requireActiveMembership } from "../mess/mess.scope";
import { resolveMonthForRead } from "../messMonth/month.service";
import { round2 } from "../messMonth/month.util";
import { calculateSummary } from "./summary.calculator";
import type {
	IMemberLedgerInput,
	ISummaryMember,
	ISummaryResult,
} from "./summary.interface";
import { calculateSettlement } from "./summary.settlement";

const summaryMemberSelect = {
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

const statusRank: Record<MemberStatus, number> = {
	[MemberStatus.ACTIVE]: 0,
	[MemberStatus.PENDING]: 1,
	[MemberStatus.LEFT]: 2,
	[MemberStatus.REJECTED]: 3,
};

/**
 * Meal and bazar ledger for one month (AC 6.1.1, AC 6.1.2).
 *
 * Only ACTIVE members are guaranteed a row. Any other member who has meal or
 * bazar data in the month is also included, so historical LEFT members still
 * receive their balance and the settlement always sums to zero. Utility bills
 * and deposits are deliberately not queried (AC 6.1.5).
 *
 * A month with no `mess_month` row returns zero totals without creating one.
 */
const getSummary = async (
	user: IRequestUser,
	monthParam?: string,
): Promise<ISummaryResult> => {
	const actor = await requireActiveMembership(user.userId);
	const { context } = await resolveMonthForRead(actor.messId, monthParam);

	// Two aggregate queries, then one member query. No per-member queries.
	const [mealGroups, bazarGroups] = await Promise.all([
		context.id
			? prisma.mealEntry.groupBy({
					by: ["memberId"],
					where: { messMonthId: context.id },
					_sum: {
						breakfast: true,
						lunch: true,
						dinner: true,
						guestMeals: true,
					},
				})
			: Promise.resolve([]),
		context.id
			? prisma.mealExpense.groupBy({
					by: ["shopperId"],
					where: { messMonthId: context.id },
					_sum: { amount: true },
				})
			: Promise.resolve([]),
	]);

	const mealsByMember = new Map<string, number>();

	for (const group of mealGroups) {
		const sums = group._sum;
		const totalMeals =
			(sums.breakfast ?? 0) +
			(sums.lunch ?? 0) +
			(sums.dinner ?? 0) +
			(sums.guestMeals ?? 0);

		mealsByMember.set(group.memberId, totalMeals);
	}

	const bazarByMember = new Map<string, number>();

	for (const group of bazarGroups) {
		bazarByMember.set(group.shopperId, Number(group._sum.amount ?? 0));
	}

	const dataMemberIds = new Set([
		...mealsByMember.keys(),
		...bazarByMember.keys(),
	]);

	const memberRows = await prisma.messMember.findMany({
		where: {
			messId: actor.messId,
			OR: [
				{ status: MemberStatus.ACTIVE },
				...(dataMemberIds.size ? [{ id: { in: [...dataMemberIds] } }] : []),
			],
		},
		select: summaryMemberSelect,
	});

	memberRows.sort((a, b) => {
		const byStatus = statusRank[a.status] - statusRank[b.status];

		if (byStatus !== 0) {
			return byStatus;
		}

		const byJoinedAt = a.joinedAt.getTime() - b.joinedAt.getTime();

		if (byJoinedAt !== 0) {
			return byJoinedAt;
		}

		return a.id.localeCompare(b.id);
	});

	const ledgers: IMemberLedgerInput[] = memberRows.map((member) => ({
		memberId: member.id,
		totalMeals: mealsByMember.get(member.id) ?? 0,
		bazarPaid: bazarByMember.get(member.id) ?? 0,
	}));

	const calculation = calculateSummary(ledgers);
	const calculationByMember = new Map(
		calculation.members.map((member) => [member.memberId, member]),
	);

	const settlement = calculateSettlement(
		calculation.members.map((member) => ({
			memberId: member.memberId,
			mealBalance: member.mealBalance,
		})),
	);

	const settledByMember = new Map(
		settlement.balances.map((balance) => [balance.memberId, balance]),
	);

	const members: ISummaryMember[] = memberRows.map((row) => {
		const member = calculationByMember.get(row.id);
		const settled = settledByMember.get(row.id);
		const bazarPaid = round2(member?.bazarPaid ?? 0);
		const mealBalance = settled?.mealBalance ?? 0;

		return {
			memberId: row.id,
			name: row.user.name,
			avatarUrl: row.user.profile?.imageUrl || null,
			status: row.status,
			totalMeals: round2(member?.totalMeals ?? 0),
			// Derive cost from the normalized balance so the displayed equation
			// bazarPaid - mealCost = mealBalance is always exact.
			mealCost: round2(bazarPaid - mealBalance),
			bazarPaid,
			mealBalance,
			balanceStatus: settled?.balanceStatus ?? "SETTLED",
		};
	});

	return {
		month: context,
		canSettle: settlement.canSettle,
		totals: {
			totalMeals: round2(calculation.totalMeals),
			totalBazar: round2(calculation.totalBazar),
			mealRate: round2(calculation.mealRate),
			totalPositiveBalance: settlement.totalPositiveBalance,
		},
		members,
		settlement: settlement.transfers,
	};
};

export const summaryService = {
	getSummary,
};
