import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import type { MessMember } from "../../generated/prisma/client";
import { MemberStatus } from "../../generated/prisma/enums";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { catchAsync } from "../utils/catchAsync";

declare global {
	namespace Express {
		interface Request {
			member?: MessMember & { mess: { id: string; name: string } };
		}
	}
}

/**
 * Authorizes the mess scope carried by the JWT.
 *
 * The token tells us which mess the request is for; this middleware is the
 * database check that decides whether the user may touch it. Always mount it
 * after `requireMess` on mess-scoped routes.
 */
export const requireActiveMember = catchAsync(
	async (req: Request, _res: Response, next: NextFunction) => {
		const userId = req.user?.userId;
		const messId = req.messId;

		if (!userId || !messId) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"No active mess selected. Please select a mess first.",
			);
		}

		const member = await prisma.messMember.findUnique({
			where: {
				userId_messId: { userId, messId },
			},
			include: {
				mess: { select: { id: true, name: true } },
			},
		});

		if (!member || member.status !== MemberStatus.ACTIVE) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You are not an active member of this mess.",
			);
		}

		req.member = member;
		next();
	},
);
