import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "../auth/auth.interface";
import { monthService } from "./month.service";

const getUser = (req: Request): IRequestUser => {
	if (!req.user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	return req.user;
};

const listMonths = catchAsync(async (req: Request, res: Response) => {
	const result = await monthService.listMonths(getUser(req));

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Months fetched successfully",
		data: result,
	});
});

const openMonth = catchAsync(async (req: Request, res: Response) => {
	const result = await monthService.openMonth(getUser(req), req.body.month);

	sendResponse(res, {
		statusCode: result.created ? httpStatus.CREATED : httpStatus.OK,
		success: true,
		message: result.created
			? "Month opened successfully"
			: "This month is already open",
		data: result,
	});
});

export const monthController = {
	listMonths,
	openMonth,
};
