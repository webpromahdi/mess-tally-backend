import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "../auth/auth.interface";
import { memberService } from "./member.service";
import { memberListQuerySchema } from "./member.validation";

const getUser = (req: Request): IRequestUser => {
	if (!req.user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	return req.user;
};

const listMembers = catchAsync(async (req: Request, res: Response) => {
	const user = getUser(req);

	const query = memberListQuerySchema.safeParse(req.query);

	if (!query.success) {
		throw new AppError(httpStatus.BAD_REQUEST, query.error.issues[0].message);
	}

	const result = await memberService.listMembers(user, query.data);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Members fetched successfully",
		data: result,
	});
});

const listPendingMembers = catchAsync(async (req: Request, res: Response) => {
	const result = await memberService.listPendingMembers(getUser(req));

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Pending join requests fetched successfully",
		data: result,
	});
});

const approveMember = catchAsync(async (req: Request, res: Response) => {
	const member = await memberService.approveMember(
		getUser(req),
		req.params.id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Join request approved successfully",
		data: member,
	});
});

const rejectMember = catchAsync(async (req: Request, res: Response) => {
	const member = await memberService.rejectMember(
		getUser(req),
		req.params.id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Join request rejected successfully",
		data: member,
	});
});

const transferManager = catchAsync(async (req: Request, res: Response) => {
	const member = await memberService.transferManager(
		getUser(req),
		req.params.id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Manager position transferred successfully",
		data: member,
	});
});

const transferOwnership = catchAsync(async (req: Request, res: Response) => {
	const member = await memberService.transferOwnership(
		getUser(req),
		req.params.id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Ownership transferred successfully",
		data: member,
	});
});

const leaveMess = catchAsync(async (req: Request, res: Response) => {
	const result = await memberService.leaveMess(getUser(req));

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "You have left the mess successfully",
		data: result,
	});
});

const removeMember = catchAsync(async (req: Request, res: Response) => {
	const result = await memberService.removeMember(
		getUser(req),
		req.params.id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Member removed successfully",
		data: result,
	});
});

export const memberController = {
	listMembers,
	listPendingMembers,
	approveMember,
	rejectMember,
	transferManager,
	transferOwnership,
	leaveMess,
	removeMember,
};
