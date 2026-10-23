import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "../auth/auth.interface";
import { dashboardService } from "./dashboard.service";
import { dashboardQuerySchema } from "./dashboard.validation";

const getUser = (req: Request): IRequestUser => {
	if (!req.user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	return req.user;
};

const getDashboard = catchAsync(async (req: Request, res: Response) => {
	const query = dashboardQuerySchema.safeParse(req.query);

	if (!query.success) {
		throw new AppError(httpStatus.BAD_REQUEST, query.error.issues[0].message);
	}

	const result = await dashboardService.getDashboard(getUser(req), query.data);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Dashboard fetched successfully",
		data: result,
	});
});

export const dashboardController = {
	getDashboard,
};
