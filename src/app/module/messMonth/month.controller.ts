import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "../auth/auth.interface";
import { monthFinalizeService } from "./monthFinalize.service";
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

const getMonthId = (req: Request): string => {
	const monthId = req.params.id;

	if (typeof monthId !== "string" || !monthId) {
		throw new AppError(httpStatus.BAD_REQUEST, "A valid month id is required.");
	}

	return monthId;
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

const closeMonth = catchAsync(async (req: Request, res: Response) => {
	const result = await monthFinalizeService.closeMonth(
		getUser(req),
		getMonthId(req),
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Month closed successfully",
		data: result,
	});
});

const reopenMonth = catchAsync(async (req: Request, res: Response) => {
	const result = await monthFinalizeService.reopenMonth(
		getUser(req),
		getMonthId(req),
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Month reopened successfully",
		data: result,
	});
});

export const monthController = {
	listMonths,
	openMonth,
	closeMonth,
	reopenMonth,
};
