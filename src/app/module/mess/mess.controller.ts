import type { Request, Response } from "express";
import httpStatus from "http-status";
import { MemberStatus } from "../../../generated/prisma/enums";
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

	const { mess } = await messService.createMess(user, payload);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Mess created successfully",
		data: {
			mess,
			activeMessId: mess.id,
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

	const { mess, membership } = await messService.joinMess(
		user,
		req.body as TJoinMess,
	);

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
			activeMessId: membership.status === MemberStatus.ACTIVE ? mess.id : null,
		},
	});
});

const getMyMesses = catchAsync(async (req: Request, res: Response) => {
	const user = req.user;
	if (!user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	const data = await messService.getMyMesses(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Messes fetched successfully",
		data,
	});
});

export const messController = {
	createMess,
	joinMess,
	getMyMesses,
};
