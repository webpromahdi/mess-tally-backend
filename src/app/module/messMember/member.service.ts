import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import { MemberStatus, MessRole } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { IRequestUser } from "../auth/auth.interface";
import {
	assertManager,
	assertOwner,
	requireActiveMembership,
} from "../mess/mess.scope";
import type {
	IMemberListItem,
	IMemberListResult,
	ILeaveMessResult,
	IRemoveMemberResult,
} from "./member.interface";
import type { TMemberListQuery } from "./member.validation";

/**
 * Every member response is built from this select so the members page, the
 * pending approval screen and the mutation endpoints always return the same
 * shape. Only whitelisted identity fields are exposed; the user password and
 * other mess memberships never leave the service.
 */
const memberSelect = {
	id: true,
	userId: true,
	role: true,
	status: true,
	isManager: true,
	rentShare: true,
	fixedRentAmount: true,
	joinedAt: true,
	leftAt: true,
	user: {
		select: {
			name: true,
			email: true,
			profile: {
				select: {
					imageUrl: true,
				},
			},
		},
	},
} satisfies Prisma.MessMemberSelect;

type TMemberRow = Prisma.MessMemberGetPayload<{ select: typeof memberSelect }>;

const toMemberListItem = (row: TMemberRow): IMemberListItem => ({
	id: row.id,
	userId: row.userId,
	name: row.user.name,
	email: row.user.email,
	avatarUrl: row.user.profile?.imageUrl || null,
	role: row.role,
	status: row.status,
	isManager: row.isManager,
	rentShare: row.rentShare,
	fixedRentAmount:
		row.fixedRentAmount === null ? null : Number(row.fixedRentAmount),
	joinedAt: row.joinedAt,
	leftAt: row.leftAt,
});

// Active members first (for dropdowns and the default members page), then the
// approval queue, then archived rows. Sorting happens in JS because Postgres
// orders enum values by declaration, which is not the UI order.
const statusRank: Record<MemberStatus, number> = {
	[MemberStatus.ACTIVE]: 0,
	[MemberStatus.PENDING]: 1,
	[MemberStatus.LEFT]: 2,
	[MemberStatus.REJECTED]: 3,
};

const sortMembers = (members: IMemberListItem[]) =>
	members.sort((a, b) => {
		const byStatus = statusRank[a.status] - statusRank[b.status];

		if (byStatus !== 0) {
			return byStatus;
		}

		return a.joinedAt.getTime() - b.joinedAt.getTime();
	});

/**
 * Loads a membership row that belongs to `messId`. Scoping by both id and mess
 * means a manager from mess A can never touch a member of mess B: the id
 * lookup simply returns null and the caller gets a 404 instead of a 403 leak.
 */
const findMessMember = async (messId: string, memberId: string) => {
	const member = await prisma.messMember.findFirst({
		where: { id: memberId, messId },
		select: memberSelect,
	});

	if (!member) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No member found with this id in your mess",
		);
	}

	return member;
};

const listMembers = async (
	user: IRequestUser,
	query: TMemberListQuery,
): Promise<IMemberListResult> => {
	const actor = await requireActiveMembership(user.userId);

	const rows = await prisma.messMember.findMany({
		where: {
			messId: actor.messId,
			...(query.status ? { status: query.status } : {}),
		},
		select: memberSelect,
		orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
	});

	const members = sortMembers(rows.map(toMemberListItem));

	return { members, total: members.length };
};

const listPendingMembers = async (
	user: IRequestUser,
): Promise<IMemberListResult> => {
	const actor = assertManager(await requireActiveMembership(user.userId));

	const rows = await prisma.messMember.findMany({
		where: { messId: actor.messId, status: MemberStatus.PENDING },
		select: memberSelect,
		orderBy: { joinedAt: "asc" },
	});

	const members = rows.map(toMemberListItem);

	return { members, total: members.length };
};

/**
 * Approving a join request makes the member ACTIVE and points their user row at
 * this mess (PRD 2.1). Decision D14 allows only one active mess per user, so a
 * request whose user became active elsewhere in the meantime is rejected.
 */
const approveMember = async (
	user: IRequestUser,
	memberId: string,
): Promise<IMemberListItem> => {
	const actor = assertManager(await requireActiveMembership(user.userId));
	const target = await findMessMember(actor.messId, memberId);

	if (target.status !== MemberStatus.PENDING) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Only pending join requests can be approved. This member is already ${target.status}.`,
		);
	}

	const otherActiveMembership = await prisma.messMember.findFirst({
		where: {
			userId: target.userId,
			status: MemberStatus.ACTIVE,
			id: { not: target.id },
		},
		select: { mess: { select: { name: true } } },
	});

	if (otherActiveMembership) {
		throw new AppError(
			httpStatus.CONFLICT,
			`This user is already an active member of "${otherActiveMembership.mess.name}". They must leave that mess before they can be approved here.`,
		);
	}

	const approved = await prisma.$transaction(async (tx) => {
		const updated = await tx.messMember.update({
			where: { id: target.id },
			data: {
				status: MemberStatus.ACTIVE,
				isManager: false,
				joinedAt: new Date(),
				leftAt: null,
			},
			select: memberSelect,
		});

		await tx.user.update({
			where: { id: target.userId },
			data: { activeMessId: actor.messId },
		});

		return updated;
	});

	return toMemberListItem(approved);
};

/**
 * Rejecting keeps the row (decision D10) so a later join request can reuse it.
 * Rejected rows are excluded from every calculation and never appear in the
 * ACTIVE member dropdowns.
 */
const rejectMember = async (
	user: IRequestUser,
	memberId: string,
): Promise<IMemberListItem> => {
	const actor = assertManager(await requireActiveMembership(user.userId));
	const target = await findMessMember(actor.messId, memberId);

	if (target.status !== MemberStatus.PENDING) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Only pending join requests can be rejected. This member is already ${target.status}.`,
		);
	}

	const rejected = await prisma.$transaction(async (tx) => {
		const updated = await tx.messMember.update({
			where: { id: target.id },
			data: {
				status: MemberStatus.REJECTED,
				isManager: false,
				leftAt: null,
			},
			select: memberSelect,
		});

		// A pending member should not own the pointer, but clear it defensively
		// so a stale pointer can never authorize this mess.
		await tx.user.updateMany({
			where: { id: target.userId, activeMessId: actor.messId },
			data: { activeMessId: null },
		});

		return updated;
	});

	return toMemberListItem(rejected);
};

/**
 * Transfers the manager position to another ACTIVE member of the same mess.
 *
 * The caller gives up `is_manager` and the target receives it, so a mess has at
 * most one manager. If the caller is the OWNER, `role` stays `OWNER` and only
 * the manager flag moves; ownership itself never transfers (D8).
 *
 * The current manager can call this, and so can the OWNER even when they no
 * longer hold the flag. That owner escape hatch matters because a manager who
 * leaves clears `is_manager`, and without it the mess could never get a new
 * manager again.
 */
const transferManager = async (
	user: IRequestUser,
	memberId: string,
): Promise<IMemberListItem> => {
	const actor = await requireActiveMembership(user.userId);

	if (actor.role !== MessRole.OWNER) {
		assertManager(actor);
	}

	const target = await findMessMember(actor.messId, memberId);

	if (target.id === actor.id) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Choose another member: you cannot transfer the manager position to yourself.",
		);
	}

	if (target.status !== MemberStatus.ACTIVE) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Only active members can hold the manager position.",
		);
	}

	const updated = await prisma.$transaction(async (tx) => {
		// Clear every other manager row in this mess (including the caller, so
		// the position is given up) and promote the target. This also repairs
		// legacy rows where more than one manager was set.
		await tx.messMember.updateMany({
			where: {
				messId: actor.messId,
				id: { not: target.id },
				isManager: true,
			},
			data: { isManager: false },
		});

		return tx.messMember.update({
			where: { id: target.id },
			data: { isManager: true },
			select: memberSelect,
		});
	});

	return toMemberListItem(updated);
};

/**
 * Transfers the OWNER role to another ACTIVE member (D8). The previous owner
 * becomes a regular MEMBER and gives up the manager position; the new owner
 * becomes the manager, matching how a mess is created (AC 1.5.1.2).
 *
 * The partial unique index `mess_member_one_owner_idx` allows one OWNER row per
 * mess, so the current owner is demoted before the target is promoted. Both
 * writes run in one transaction.
 */
const transferOwnership = async (
	user: IRequestUser,
	memberId: string,
): Promise<IMemberListItem> => {
	const owner = assertOwner(await requireActiveMembership(user.userId));
	const target = await findMessMember(owner.messId, memberId);

	if (target.id === owner.id) {
		throw new AppError(httpStatus.BAD_REQUEST, "You already own this mess.");
	}

	if (target.status !== MemberStatus.ACTIVE) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Ownership can only be transferred to an active member.",
		);
	}

	const updated = await prisma.$transaction(async (tx) => {
		// Demote first: the one-OWNER unique index is checked per statement, so
		// promoting the target while the caller is still OWNER would fail.
		await tx.messMember.update({
			where: { id: owner.id },
			data: { role: MessRole.MEMBER, isManager: false },
		});

		// Clear any legacy duplicate manager rows so the new owner is the only
		// manager after the transfer.
		await tx.messMember.updateMany({
			where: {
				messId: owner.messId,
				id: { not: target.id },
				isManager: true,
			},
			data: { isManager: false },
		});

		return tx.messMember.update({
			where: { id: target.id },
			data: { role: MessRole.OWNER, isManager: true },
			select: memberSelect,
		});
	});

	return toMemberListItem(updated);
};

/**
 * Leaving sets LEFT + leftAt and clears the active mess pointer, which is the
 * only supported way to switch messes (decision D7).
 *
 * An owner cannot leave while other ACTIVE members exist: they must transfer
 * ownership first (D8). When the owner is the last active member there is
 * nobody to transfer to, so leaving empty-handed is allowed.
 */
const leaveMess = async (user: IRequestUser): Promise<ILeaveMessResult> => {
	const member = await requireActiveMembership(user.userId);

	if (member.role === MessRole.OWNER) {
		const otherActiveMembers = await prisma.messMember.count({
			where: {
				messId: member.messId,
				status: MemberStatus.ACTIVE,
				id: { not: member.id },
			},
		});

		if (otherActiveMembers > 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				`You are the owner of "${member.mess.name}". Transfer ownership to another active member before leaving the mess.`,
			);
		}
	}

	const leftAt = new Date();

	await prisma.$transaction([
		prisma.messMember.update({
			where: { id: member.id },
			data: {
				status: MemberStatus.LEFT,
				leftAt,
				isManager: false,
			},
		}),
		prisma.user.update({
			where: { id: member.userId },
			data: { activeMessId: null },
		}),
	]);

	return { messId: member.messId, leftAt, activeMessId: null };
};

/**
 * Hard-deletes a membership only when no financial/log data points at it
 * (AC 2.1.3). Meal entries, bazar, deposits, utility bills and payments all
 * reference `mess_member` with RESTRICT, so those rows must be counted first to
 * return a clear 409 instead of a raw foreign-key error. The suggested action
 * is always `status = LEFT` (decision D12).
 */
const removeMember = async (
	user: IRequestUser,
	memberId: string,
): Promise<IRemoveMemberResult> => {
	const actor = assertManager(await requireActiveMembership(user.userId));
	const target = await findMessMember(actor.messId, memberId);

	if (target.id === actor.id) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"You cannot remove yourself. Use POST /api/mess/leave to leave the mess.",
		);
	}

	if (target.role === MessRole.OWNER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"The mess owner cannot be removed from the mess.",
		);
	}

	const [mealEntries, bazarEntries, deposits, utilityBills, payments] =
		await Promise.all([
			prisma.mealEntry.count({ where: { memberId: target.id } }),
			prisma.mealExpense.count({
				where: {
					OR: [{ shopperId: target.id }, { addedById: target.id }],
				},
			}),
			prisma.deposit.count({
				where: {
					OR: [{ memberId: target.id }, { receivedById: target.id }],
				},
			}),
			prisma.utilityExpense.count({
				where: { addedById: target.id },
			}),
			prisma.payment.count({ where: { paidByMemberId: target.id } }),
		]);

	const blockers = [
		mealEntries
			? `${mealEntries} meal entr${mealEntries === 1 ? "y" : "ies"}`
			: null,
		bazarEntries
			? `${bazarEntries} bazar entr${bazarEntries === 1 ? "y" : "ies"}`
			: null,
		deposits ? `${deposits} deposit${deposits === 1 ? "" : "s"}` : null,
		utilityBills
			? `${utilityBills} utility bill${utilityBills === 1 ? "" : "s"}`
			: null,
		payments ? `${payments} payment${payments === 1 ? "" : "s"}` : null,
	].filter((blocker): blocker is string => blocker !== null);

	if (blockers.length) {
		throw new AppError(
			httpStatus.CONFLICT,
			`This member has existing records (${blockers.join(
				", ",
			)}). Set the membership status to LEFT instead of deleting it.`,
		);
	}

	await prisma.$transaction(async (tx) => {
		// Free the pointer before the membership row disappears.
		await tx.user.updateMany({
			where: { id: target.userId, activeMessId: actor.messId },
			data: { activeMessId: null },
		});

		await tx.messMember.delete({ where: { id: target.id } });
	});

	return { id: target.id, deleted: true };
};

export const memberService = {
	listMembers,
	listPendingMembers,
	approveMember,
	rejectMember,
	transferManager,
	transferOwnership,
	leaveMess,
	removeMember,
};
