import type { Role } from "../../generated/prisma/enums";
import config from "../config";
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
 * Tokens carry identity only (`userId`, `name`, `email`, `role`). The active
 * mess is never part of the JWT: mess-scoped services resolve it from
 * `user.activeMessId` and verify the membership in the database.
 */
export const createAuthTokens = async (user: ITokenUser) => {
	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
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
