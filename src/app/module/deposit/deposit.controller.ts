import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "../auth/auth.interface";
import { depositService } from "./deposit.service";
import { depositListQuerySchema } from "./deposit.validation";

const getUser = (req: Request): IRequestUser => {
	if (!req.user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	return req.user;
};

const listDeposits = catchAsync(async (req: Request, res: Response) => {
	const query = depositListQuerySchema.safeParse(req.query);

	if (!query.success) {
		throw new AppError(httpStatus.BAD_REQUEST, query.error.issues[0].message);
	}

	const result = await depositService.listDeposits(getUser(req), query.data);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Fund deposits fetched successfully",
		data: result,
	});
});

const createDeposit = catchAsync(async (req: Request, res: Response) => {
	const result = await depositService.createDeposit(getUser(req), req.body);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Fund deposit recorded successfully",
		data: result,
	});
});

const updateDeposit = catchAsync(async (req: Request, res: Response) => {
	const result = await depositService.updateDeposit(
		getUser(req),
		req.params.id as string,
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Fund deposit updated successfully",
		data: result,
	});
});

const deleteDeposit = catchAsync(async (req: Request, res: Response) => {
	const result = await depositService.deleteDeposit(
		getUser(req),
		req.params.id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Fund deposit deleted successfully",
		data: result,
	});
});

export const depositController = {
	listDeposits,
	createDeposit,
	updateDeposit,
	deleteDeposit,
};
