import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import {
	MemberStatus,
	MessPlan,
	MessRole,
	PaymentStatus,
	type PaymentType,
	Role,
	Status,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { addDays } from "../../utils/time";
import { toMoney } from "../../utils/money";
import type { IRequestUser } from "../auth/auth.interface";
import {
	FREE_ACTIVE_MEMBER_LIMIT,
	isProActive,
	nextProPeriod,
	PRO_ACTIVE_MEMBER_LIMIT,
} from "../subscription/plan";
import { bucketRevenueByMonth, pageMeta } from "./admin.utils";
import type {
	TAdminMessListQuery,
	TAdminRevenueQuery,
	TAdminUserListQuery,
	TGrantPro,
	TUpdateUserRole,
	TUpdateUserStatus,
} from "./admin.validation";

const insensitive = (value: string) => ({
	contains: value,
	mode: "insensitive" as const,
});

// Revenue counts money that was actually collected: PAID, plus REFUNDED
// payments (collected, then returned; the refund is subtracted separately).
const COLLECTED = [PaymentStatus.PAID, PaymentStatus.REFUNDED];

const startOfUtcMonth = (date: Date) =>
	new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const refundOf = (payment: {
	status: PaymentStatus;
	amount: Prisma.Decimal;
	refundAmount: Prisma.Decimal | null;
}) =>
	payment.status === PaymentStatus.REFUNDED
		? toMoney(payment.refundAmount ?? payment.amount)
		: 0;

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

const getOverview = async () => {
	const now = new Date();
	const monthStart = startOfUtcMonth(now);
	const proWhere = { plan: MessPlan.PRO, planExpiresAt: { gt: now } };

	const [
		totalUsers,
		activeUsers,
		suspendedUsers,
		newUsersThisMonth,
		totalMesses,
		proMesses,
		expiringSoon,
		collected,
	] = await prisma.$transaction([
		prisma.user.count({ where: { isDeleted: false } }),
		prisma.user.count({ where: { isDeleted: false, status: Status.ACTIVE } }),
		prisma.user.count({ where: { status: Status.SUSPENDED } }),
		prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
		prisma.mess.count(),
		prisma.mess.count({ where: proWhere }),
		prisma.mess.count({
			where: {
				plan: MessPlan.PRO,
				planExpiresAt: { gt: now, lte: addDays(now, 7) },
			},
		}),
		prisma.payment.findMany({
			where: { status: { in: COLLECTED }, paidAt: { not: null } },
			select: {
				status: true,
				amount: true,
				refundAmount: true,
				paidAt: true,
			},
		}),
	]);

	let revenueAllTime = 0;
	let revenueThisMonth = 0;
	for (const payment of collected) {
		const net = toMoney(payment.amount) - refundOf(payment);
		revenueAllTime += net;
		if (payment.paidAt && payment.paidAt >= monthStart) revenueThisMonth += net;
	}

	return {
		users: {
			total: totalUsers,
			active: activeUsers,
			suspended: suspendedUsers,
			newThisMonth: newUsersThisMonth,
		},
		messes: {
			total: totalMesses,
			pro: proMesses,
			free: totalMesses - proMesses,
			proExpiringIn7Days: expiringSoon,
		},
		revenue: {
			allTime: toMoney(revenueAllTime),
			thisMonth: toMoney(revenueThisMonth),
			currency: "BDT",
		},
	};
};

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

const userSelect = {
	id: true,
	name: true,
	email: true,
	role: true,
	status: true,
	emailVerified: true,
	isDeleted: true,
	createdAt: true,
	profile: { select: { phone: true, imageUrl: true } },
	activeMess: { select: { id: true, name: true } },
	memberships: {
		select: {
			role: true,
			isManager: true,
			status: true,
			joinedAt: true,
			mess: { select: { id: true, name: true } },
		},
		orderBy: { joinedAt: "desc" as const },
	},
} satisfies Prisma.UserSelect;

type TUserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const toAdminUser = (user: TUserRow) => ({
	id: user.id,
	name: user.name,
	email: user.email,
	role: user.role,
	status: user.status,
	emailVerified: user.emailVerified,
	isDeleted: user.isDeleted,
	createdAt: user.createdAt,
	phone: user.profile?.phone || null,
	imageUrl: user.profile?.imageUrl || null,
	activeMess: user.activeMess,
	memberships: user.memberships.map((m) => ({
		messId: m.mess.id,
		messName: m.mess.name,
		role: m.role,
		isManager: m.isManager,
		status: m.status,
		joinedAt: m.joinedAt,
	})),
});

const listUsers = async (query: TAdminUserListQuery) => {
	const filters: Prisma.UserWhereInput[] = [];
	if (query.search) {
		filters.push({
			OR: [
				{ name: insensitive(query.search) },
				{ email: insensitive(query.search) },
			],
		});
	}
	if (query.mess) {
		filters.push({
			memberships: { some: { mess: { name: insensitive(query.mess) } } },
		});
	}
	if (query.role) filters.push({ role: query.role });
	if (query.status) filters.push({ status: query.status });
	const where: Prisma.UserWhereInput = { AND: filters };

	const [rows, total] = await prisma.$transaction([
		prisma.user.findMany({
			where,
			select: userSelect,
			orderBy: { createdAt: "desc" },
			skip: (query.page - 1) * query.limit,
			take: query.limit,
		}),
		prisma.user.count({ where }),
	]);

	return {
		users: rows.map(toAdminUser),
		meta: pageMeta(query.page, query.limit, total),
	};
};

const findTargetUser = async (actor: IRequestUser, userId: string) => {
	if (userId === actor.userId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"You cannot change your own account from the admin panel.",
		);
	}

	const target = await prisma.user.findUnique({
		where: { id: userId },
		select: { id: true, role: true, isDeleted: true },
	});

	if (!target || target.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found.");
	}

	if (target.role === Role.SUPERADMIN) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"A super admin account cannot be changed from the admin panel.",
		);
	}

	return target;
};

const updateUserStatus = async (
	actor: IRequestUser,
	userId: string,
	payload: TUpdateUserStatus,
) => {
	const target = await findTargetUser(actor, userId);

	if (target.role === Role.ADMIN && actor.role !== Role.SUPERADMIN) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only a super admin can suspend or reactivate another admin.",
		);
	}

	// `auth()` checks status on every request and login/refresh reject
	// SUSPENDED, so this takes effect on the user's next request.
	const updated = await prisma.user.update({
		where: { id: target.id },
		data: { status: payload.status },
		select: userSelect,
	});

	return toAdminUser(updated);
};

const updateUserRole = async (
	actor: IRequestUser,
	userId: string,
	payload: TUpdateUserRole,
) => {
	const target = await findTargetUser(actor, userId);

	const updated = await prisma.user.update({
		where: { id: target.id },
		data: { role: payload.role },
		select: userSelect,
	});

	return toAdminUser(updated);
};

/* ------------------------------------------------------------------ */
/* Messes                                                              */
/* ------------------------------------------------------------------ */

const messSelect = {
	id: true,
	name: true,
	roomCode: true,
	plan: true,
	planExpiresAt: true,
	createdAt: true,
	_count: {
		select: { members: { where: { status: MemberStatus.ACTIVE } } },
	},
	members: {
		where: {
			status: MemberStatus.ACTIVE,
			OR: [{ role: MessRole.OWNER }, { isManager: true }],
		},
		select: {
			role: true,
			isManager: true,
			user: { select: { id: true, name: true, email: true } },
		},
	},
	payments: {
		where: { status: { in: COLLECTED } },
		select: {
			type: true,
			status: true,
			amount: true,
			refundAmount: true,
			periodStart: true,
			periodEnd: true,
		},
		orderBy: { paidAt: "desc" as const },
	},
} satisfies Prisma.MessSelect;

type TMessRow = Prisma.MessGetPayload<{ select: typeof messSelect }>;

const typeKey = (type: PaymentType) => type.replace("SUBSCRIPTION_", "");

const toAdminMess = (mess: TMessRow, now: Date) => {
	const isPro = isProActive(mess, now);
	const owner =
		mess.members.find((m) => m.role === MessRole.OWNER)?.user ?? null;
	const manager = mess.members.find((m) => m.isManager)?.user ?? null;
	const current = isPro
		? mess.payments.find(
				(p) =>
					p.status === PaymentStatus.PAID &&
					p.periodStart &&
					p.periodEnd &&
					p.periodStart <= now &&
					now < p.periodEnd,
			)
		: undefined;
	const totalPaid = mess.payments.reduce(
		(sum, p) => sum + toMoney(p.amount) - refundOf(p),
		0,
	);

	return {
		id: mess.id,
		name: mess.name,
		roomCode: mess.roomCode,
		plan: isPro ? MessPlan.PRO : MessPlan.FREE,
		planExpiresAt: mess.planExpiresAt,
		// null on PRO means the current period was granted by an admin.
		subscriptionType: current ? typeKey(current.type) : null,
		activeMembers: mess._count.members,
		memberLimit: isPro ? PRO_ACTIVE_MEMBER_LIMIT : FREE_ACTIVE_MEMBER_LIMIT,
		owner,
		manager,
		totalPaid: toMoney(totalPaid),
		createdAt: mess.createdAt,
	};
};

const listMesses = async (query: TAdminMessListQuery) => {
	const now = new Date();
	const filters: Prisma.MessWhereInput[] = [];

	if (query.search) {
		filters.push({
			OR: [
				{ name: insensitive(query.search) },
				{ roomCode: insensitive(query.search) },
			],
		});
	}
	if (query.plan === "PRO") {
		filters.push({ plan: MessPlan.PRO, planExpiresAt: { gt: now } });
	} else if (query.plan === "FREE") {
		filters.push({
			OR: [
				{ plan: MessPlan.FREE },
				{ planExpiresAt: null },
				{ planExpiresAt: { lte: now } },
			],
		});
	}
	if (query.subscriptionType) {
		filters.push({
			payments: {
				some: {
					status: PaymentStatus.PAID,
					type: `SUBSCRIPTION_${query.subscriptionType}` as PaymentType,
					periodStart: { lte: now },
					periodEnd: { gt: now },
				},
			},
		});
	}
	const where: Prisma.MessWhereInput = { AND: filters };

	const [rows, total] = await prisma.$transaction([
		prisma.mess.findMany({
			where,
			select: messSelect,
			orderBy: { createdAt: "desc" },
			skip: (query.page - 1) * query.limit,
			take: query.limit,
		}),
		prisma.mess.count({ where }),
	]);

	return {
		messes: rows.map((row) => toAdminMess(row, now)),
		meta: pageMeta(query.page, query.limit, total),
	};
};

/** Grants or extends PRO without a payment (support/comp). Not counted as revenue. */
const grantPro = async (messId: string, payload: TGrantPro) => {
	const mess = await prisma.mess.findUnique({
		where: { id: messId },
		select: { id: true, plan: true, planExpiresAt: true },
	});

	if (!mess) {
		throw new AppError(httpStatus.NOT_FOUND, "Mess not found.");
	}

	const { periodEnd } = nextProPeriod(mess, payload.days);

	const updated = await prisma.mess.update({
		where: { id: mess.id },
		data: { plan: MessPlan.PRO, planExpiresAt: periodEnd },
		select: messSelect,
	});

	return toAdminMess(updated, new Date());
};

/* ------------------------------------------------------------------ */
/* Revenue                                                             */
/* ------------------------------------------------------------------ */

const MAX_RANGE_DAYS = 366 * 5;

const getRevenue = async (query: TAdminRevenueQuery) => {
	const now = new Date();
	const to = query.to ? new Date(`${query.to}T00:00:00.000Z`) : now;
	// Default: the current month and the 11 before it.
	const from = query.from
		? new Date(`${query.from}T00:00:00.000Z`)
		: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
	// `to` is a calendar day, so include all of it.
	const toExclusive = query.to ? addDays(to, 1) : to;

	if ((toExclusive.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Choose a range of at most 5 years.",
		);
	}

	const where: Prisma.PaymentWhereInput = {
		status: { in: COLLECTED },
		paidAt: { gte: from, lt: toExclusive },
	};

	const [inRange, recent, recentTotal] = await prisma.$transaction([
		prisma.payment.findMany({
			where,
			select: {
				type: true,
				status: true,
				amount: true,
				refundAmount: true,
				paidAt: true,
			},
		}),
		prisma.payment.findMany({
			where,
			orderBy: { paidAt: "desc" },
			skip: (query.page - 1) * query.limit,
			take: query.limit,
			select: {
				id: true,
				type: true,
				status: true,
				amount: true,
				refundAmount: true,
				currency: true,
				durationDays: true,
				paidAt: true,
				bkashTrxId: true,
				mess: { select: { id: true, name: true } },
				paidBy: { select: { user: { select: { name: true, email: true } } } },
			},
		}),
		prisma.payment.count({ where }),
	]);

	let gross = 0;
	let refunds = 0;
	const byType = new Map<
		string,
		{ type: string; amount: number; count: number }
	>();
	for (const payment of inRange) {
		const amount = toMoney(payment.amount);
		const refund = refundOf(payment);
		gross += amount;
		refunds += refund;
		const key = typeKey(payment.type);
		const entry = byType.get(key) ?? { type: key, amount: 0, count: 0 };
		entry.amount = toMoney(entry.amount + amount - refund);
		entry.count += 1;
		byType.set(key, entry);
	}

	return {
		range: { from, to: toExclusive },
		currency: "BDT",
		totals: {
			gross: toMoney(gross),
			refunds: toMoney(refunds),
			net: toMoney(gross - refunds),
			payments: inRange.length,
		},
		byType: [...byType.values()],
		monthly: bucketRevenueByMonth(
			inRange.map((p) => ({
				amount: toMoney(p.amount) - refundOf(p),
				paidAt: p.paidAt as Date,
			})),
			from,
			// The last included instant, so an exclusive month boundary isn't added.
			new Date(toExclusive.getTime() - 1),
		),
		payments: recent.map((p) => ({
			id: p.id,
			type: typeKey(p.type),
			status: p.status,
			amount: toMoney(p.amount),
			refundAmount: p.refundAmount ? toMoney(p.refundAmount) : null,
			currency: p.currency,
			durationDays: p.durationDays,
			paidAt: p.paidAt,
			bkashTrxId: p.bkashTrxId,
			mess: p.mess,
			paidBy: p.paidBy.user,
		})),
		meta: pageMeta(query.page, query.limit, recentTotal),
	};
};

export const adminService = {
	getOverview,
	listUsers,
	updateUserStatus,
	updateUserRole,
	listMesses,
	grantPro,
	getRevenue,
};
