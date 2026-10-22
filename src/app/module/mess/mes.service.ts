import httpStatus from "http-status";
import Sqids from "sqids";
import {
	MemberStatus,
	MessRole,
	Status,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { IRequestUser } from "../auth/auth.interface";
import type { ICreateMessPayload, IJoinMessPayload } from "./mess.interface";

// Shuffle your unambiguous alphabet once and keep it consistent across your app
const sqids = new Sqids({
	alphabet: "K7P9M2X4ABCDEFGHJLNQRSTUVWY3568Z",
	minLength: 8,
});

const generateRoomCode = (
	sequenceId: number | bigint,
	messName: string,
): string => {
	const prefix = messName
		.toUpperCase()
		.replace(/[^A-Z]/g, "")
		.slice(0, 3)
		.padEnd(3, "X");

	// Encode the unique DB integer into an 8-char code (e.g., "SUN-K7P9M2X4")
	const code = sqids.encode([Number(sequenceId)]);
	return `${prefix}-${code}`;
};

const createMess = async (user: IRequestUser, payload: ICreateMessPayload) => {
	const name = payload.name?.trim();

	if (!name) {
		throw new AppError(httpStatus.BAD_REQUEST, "Mess name is required");
	}

	const existingUser = await prisma.user.findUnique({
		where: { id: user.userId },
		omit: {
			password: true,
		},
	});

	if (!existingUser || existingUser.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	if (existingUser.status !== Status.ACTIVE) {
		throw new AppError(httpStatus.FORBIDDEN, "User is not active");
	}

	const activeMembership = await prisma.messMember.findFirst({
		where: {
			userId: existingUser.id,
			status: MemberStatus.ACTIVE,
		},
		select: {
			messId: true,
			mess: { select: { name: true } },
		},
	});

	if (activeMembership) {
		throw new AppError(
			httpStatus.CONFLICT,
			`You are already an active member of "${activeMembership.mess.name}". Leave that mess before creating a new one.`,
		);
	}

	const createdMess = await prisma.$transaction(async (tx) => {
		// Atomically grab the next guaranteed-unique integer from PostgreSQL
		const [{ nextval }] = await tx.$queryRaw<{ nextval: bigint }[]>`
            SELECT nextval('mess_room_code_seq')
        `;

		const mess = await tx.mess.create({
			data: {
				name,
				address: payload.address?.trim() || null,
				currency: payload.currency?.trim().toUpperCase() || "BDT",
				mealCutoffTime: payload.mealCutoffTime?.trim() || "11:00",
				isJoinable: payload.isJoinable ?? true,
				requireApproval: payload.requireApproval ?? true,
				roomCode: generateRoomCode(nextval, name),
				members: {
					create: {
						userId: existingUser.id,
						role: MessRole.OWNER,
						status: MemberStatus.ACTIVE,
						isManager: true,
					},
				},
			},
			include: {
				members: true,
			},
		});

		// The stored pointer every mess-scoped service resolves from.
		await tx.user.update({
			where: { id: existingUser.id },
			data: { activeMessId: mess.id },
		});

		return mess;
	});

	return { mess: createdMess };
};

const joinMess = async (user: IRequestUser, payload: IJoinMessPayload) => {
	const roomCode = payload.roomCode.trim().toUpperCase();

	const mess = await prisma.mess.findUnique({
		where: { roomCode },
	});

	if (!mess) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No mess found with this room code",
		);
	}

	if (!mess.isJoinable) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"This mess is not accepting new members",
		);
	}

	const [activeMembership, existingMembership] = await Promise.all([
		prisma.messMember.findFirst({
			where: { userId: user.userId, status: MemberStatus.ACTIVE },
			select: {
				messId: true,
				mess: { select: { name: true } },
			},
		}),
		prisma.messMember.findUnique({
			where: {
				userId_messId: { userId: user.userId, messId: mess.id },
			},
		}),
	]);

	if (activeMembership) {
		throw new AppError(
			httpStatus.CONFLICT,
			activeMembership.messId === mess.id
				? "You are already an active member of this mess"
				: `You are already an active member of "${activeMembership.mess.name}". Leave it before joining another mess`,
		);
	}

	if (
		existingMembership &&
		existingMembership.status !== MemberStatus.LEFT &&
		existingMembership.status !== MemberStatus.REJECTED
	) {
		throw new AppError(
			httpStatus.CONFLICT,
			existingMembership.status === MemberStatus.PENDING
				? "Your join request for this mess is already pending approval"
				: "You are already a member of this mess",
		);
	}

	const status = mess.requireApproval
		? MemberStatus.PENDING
		: MemberStatus.ACTIVE;

	const membership = await prisma.messMember.upsert({
		where: {
			userId_messId: { userId: user.userId, messId: mess.id },
		},
		create: {
			userId: user.userId,
			messId: mess.id,
			status,
			role: MessRole.MEMBER,
		},
		update: {
			status,
			role: MessRole.MEMBER,
			isManager: false,
			rentShare: 1.0,
			fixedRentAmount: null,
			joinedAt: new Date(),
			leftAt: null,
		},
	});

	if (membership.status === MemberStatus.ACTIVE) {
		await prisma.user.update({
			where: { id: user.userId },
			data: { activeMessId: mess.id },
		});
	}

	return { mess, membership };
};

const getMyMesses = async (user: IRequestUser) => {
	const [userRow, memberships] = await Promise.all([
		prisma.user.findUnique({
			where: { id: user.userId },
			select: { activeMessId: true },
		}),
		prisma.messMember.findMany({
			where: {
				userId: user.userId,
				status: { not: MemberStatus.REJECTED },
			},
			orderBy: { joinedAt: "desc" },
			select: {
				id: true,
				role: true,
				status: true,
				isManager: true,
				joinedAt: true,
				leftAt: true,
				mess: {
					select: {
						id: true,
						name: true,
						address: true,
						currency: true,
						roomCode: true,
						isJoinable: true,
						requireApproval: true,
						mealCutoffTime: true,
					},
				},
			},
		}),
	]);

	// The pointer is only echoed back when it still matches an ACTIVE membership.
	// A stale pointer is treated as "no active mess" instead of leaking a mess
	// the user no longer belongs to.
	const activeMessId = userRow?.activeMessId
		? (memberships.find(
				(member) =>
					member.status === MemberStatus.ACTIVE &&
					member.mess.id === userRow.activeMessId,
			)?.mess.id ?? null)
		: null;

	const statusOrder: Record<MemberStatus, number> = {
		[MemberStatus.ACTIVE]: 0,
		[MemberStatus.PENDING]: 1,
		[MemberStatus.LEFT]: 2,
		[MemberStatus.REJECTED]: 3,
	};

	const messes = memberships
		.map((member) => ({
			membershipId: member.id,
			role: member.role,
			status: member.status,
			isManager: member.isManager,
			joinedAt: member.joinedAt,
			leftAt: member.leftAt,
			isActive: member.mess.id === activeMessId,
			mess: member.mess,
		}))
		.sort((a, b) => {
			const byStatus = statusOrder[a.status] - statusOrder[b.status];

			if (byStatus !== 0) {
				return byStatus;
			}

			return b.joinedAt.getTime() - a.joinedAt.getTime();
		});

	return { activeMessId, messes };
};

export const messService = {
	createMess,
	joinMess,
	getMyMesses,
};
