import httpStatus from "http-status";
import {
	MemberStatus,
	MessRole,
	Status,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { createAuthTokens } from "../../utils/authToken";
import type { IRequestUser } from "../auth/auth.interface";
import type { ICreateMessPayload, IJoinMessPayload } from "./mess.interface";
import Sqids from "sqids";

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

	// Atomically grab the next guaranteed-unique integer from PostgreSQL
	const [{ nextval }] = await prisma.$queryRaw<{ nextval: bigint }[]>`
        SELECT nextval('mess_room_code_seq')
    `;

	const createdMess = await prisma.mess.create({
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

	const { accessToken, refreshToken } = await createAuthTokens({
		id: existingUser.id,
		name: existingUser.name,
		email: existingUser.email,
		role: existingUser.role,
	});

	return {
		mess: createdMess,
		accessToken,
		refreshToken,
	};
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
		const { accessToken, refreshToken } = await createAuthTokens({
			id: user.userId,
			name: user.name,
			email: user.email,
			role: user.role,
		});

		return { mess, membership, accessToken, refreshToken };
	}

	return { mess, membership };
};

export const messService = {
	createMess,
	joinMess,
};
