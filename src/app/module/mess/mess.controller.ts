import type { Request, Response } from "express";
import httpStatus from "http-status";
import { MemberStatus } from "../../../generated/prisma/enums";
import config from "../../config";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { ICreateMessPayload } from "./mess.interface";
import type { TJoinMess } from "./mess.validations";
import { messService } from "./mes.service";

const createMess = catchAsync(async (req: Request, res: Response) => {
	const user = req.user;
	if (!user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	const payload = req.body as ICreateMessPayload;

	const { mess, accessToken, refreshToken } = await messService.createMess(
		user,
		payload,
	);

	res.cookie("accessToken", accessToken, {
		httpOnly: true,
		secure: config.node_env !== "development",
		sameSite: config.node_env === "development" ? "lax" : "none",
		maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
	});
	res.cookie("refreshToken", refreshToken, {
		httpOnly: true,
		secure: config.node_env !== "development",
		sameSite: config.node_env === "development" ? "lax" : "none",
		maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
	});

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Mess created successfully",
		data: {
			mess,
			accessToken,
			refreshToken,
		},
	});
});

const joinMess = catchAsync(async (req: Request, res: Response) => {
	const user = req.user;
	if (!user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	const { mess, membership, accessToken, refreshToken } =
		await messService.joinMess(user, req.body as TJoinMess);

	if (accessToken && refreshToken) {
		res.cookie("accessToken", accessToken, {
			httpOnly: true,
			secure: config.node_env !== "development",
			sameSite: config.node_env === "development" ? "lax" : "none",
			maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
		});
		res.cookie("refreshToken", refreshToken, {
			httpOnly: true,
			secure: config.node_env !== "development",
			sameSite: config.node_env === "development" ? "lax" : "none",
			maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
		});
	}

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message:
			membership.status === MemberStatus.PENDING
				? "Join request sent. Waiting for approval"
				: "Joined the mess successfully",
		data: {
			mess,
			membership,
			...(accessToken && refreshToken ? { accessToken, refreshToken } : {}),
		},
	});
});

export const messController = {
	createMess,
	joinMess,
};
