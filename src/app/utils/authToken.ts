import { MemberStatus, type Role } from "../../generated/prisma/enums";
import config from "../config";
import { prisma } from "../lib/prisma";
import { jwtUtils } from "./jwt";

interface ITokenUser {
	id: string;
	name: string;
	email: string;
	role: Role;
}

/**
 * Issues a fresh access/refresh token pair for a user.
 *
 * `messId` is always resolved from the database (the user's ACTIVE
 * membership), never copied from an old token, so a stale claim cannot
 * survive a refresh.
 */
export const createAuthTokens = async (user: ITokenUser) => {
	const activeMembership = await prisma.messMember.findFirst({
		where: {
			userId: user.id,
			status: MemberStatus.ACTIVE,
		},
		select: {
			messId: true,
		},
		orderBy: {
			joinedAt: "desc",
		},
	});

	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
		...(activeMembership ? { messId: activeMembership.messId } : {}),
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in,
	);

	return {
		accessToken,
		refreshToken,
	};
};
