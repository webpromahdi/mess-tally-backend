import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import type { JwtPayload } from "jsonwebtoken";
import { Status, type Role } from "../../generated/prisma/enums";
import config from "../config";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { catchAsync } from "../utils/catchAsync";
import { jwtUtils } from "../utils/jwt";

declare global {
	namespace Express {
		interface Request {
			user?: {
				email: string;
				name: string;
				userId: string;
				role: Role;
			};
		}
	}
}

const normalizeToken = (value?: string) => {
	if (!value) return null;

	const token = value
		.trim()
		.replace(/^["']+|["']+$/g, "")
		.trim();

	return token.length ? token : null;
};

const getHeaderToken = (req: Request) => {
	const header = req.headers.authorization?.trim();

	if (!header) return null;

	const bearerMatch = header.match(/^Bearer\s+(.+)$/i);

	if (bearerMatch) {
		return normalizeToken(bearerMatch[1]);
	}

	// Bare "Bearer" with no token after it.
	if (/^Bearer$/i.test(header)) return null;

	return normalizeToken(header);
};

const getCookieToken = (req: Request) => {
	const cookie = req.cookies?.accessToken;

	return typeof cookie === "string" ? normalizeToken(cookie) : null;
};

// auth(Role.ADMIN, Role.USER, Role.Author)
// auth() => ...requiredRoles => [Role.ADMIN, Role.USER, Role.AUTHOR]
export const auth = (...requiredRoles: Role[]) => {
	return catchAsync(
		async (req: Request, _res: Response, next: NextFunction) => {
			const tokenCandidates = [getHeaderToken(req), getCookieToken(req)].filter(
				(token): token is string => token !== null,
			);

			let payload: JwtPayload | undefined;

			for (const token of tokenCandidates) {
				const verifiedToken = jwtUtils.verifyToken(
					token,
					config.jwt_access_secret,
				);

				if (verifiedToken.success && verifiedToken.data) {
					payload = verifiedToken.data as JwtPayload;
					break;
				}
			}

			if (!payload) {
				throw new AppError(
					httpStatus.UNAUTHORIZED,
					tokenCandidates.length
						? "Invalid or expired token. Please log in again."
						: "You are not logged in. Please log in to access this resource.",
				);
			}

			const { email, name, userId, role } = payload;

			if (!userId || !email || !name || !role) {
				throw new AppError(
					httpStatus.UNAUTHORIZED,
					"Invalid token payload. Please log in again.",
				);
			}

			if (requiredRoles.length && !requiredRoles.includes(role)) {
				throw new AppError(
					httpStatus.FORBIDDEN,
					"Forbidden. You don't have permission to access this resource.",
				);
			}

			const user = await prisma.user.findUnique({
				where: {
					id: userId,
					email,
					name,
					role,
				},
			});

			if (!user) {
				throw new AppError(
					httpStatus.UNAUTHORIZED,
					"User not found. Please log in again.",
				);
			}

			if (user.status === Status.SUSPENDED) {
				throw new AppError(
					httpStatus.FORBIDDEN,
					"Your account has been suspended. Please contact support.",
				);
			}

			req.user = {
				email,
				name,
				userId,
				role,
			};

			next();
		},
	);
};
