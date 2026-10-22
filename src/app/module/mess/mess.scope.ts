import httpStatus from "http-status";
import { MemberStatus, MessRole } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { TActiveMember } from "./mess.interface";

/**
 * Resolves the caller's active mess without trusting the JWT.
 *
 * `user.activeMessId` is the pointer written on create/join/approve and
 * cleared on leave. It is always verified against `mess_member` so a stale
 * pointer can never authorize a mess the user no longer belongs to.
 */
export const requireActiveMembership = async (
	userId: string,
): Promise<TActiveMember> => {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { activeMessId: true },
	});

	if (!user?.activeMessId) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not an active member of any mess.",
		);
	}

	const member = await prisma.messMember.findUnique({
		where: {
			userId_messId: { userId, messId: user.activeMessId },
		},
		include: { mess: true },
	});

	if (!member || member.status !== MemberStatus.ACTIVE) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Your active mess is no longer valid. Please select a mess again.",
		);
	}

	return member;
};

export const assertManager = (member: TActiveMember) => {
	if (!member.isManager) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Manager access is required for this action.",
		);
	}

	return member;
};

export const assertOwner = (member: TActiveMember) => {
	if (member.role !== MessRole.OWNER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only the mess owner can perform this action.",
		);
	}

	return member;
};
