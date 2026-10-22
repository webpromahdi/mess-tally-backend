import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "../auth/auth.interface";
import { utilityService } from "./utility.service";
import { utilityListQuerySchema } from "./utility.validation";

const getUser = (req: Request): IRequestUser => {
	if (!req.user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	return req.user;
};

const listUtilities = catchAsync(async (req: Request, res: Response) => {
	const query = utilityListQuerySchema.safeParse(req.query);

	if (!query.success) {
		throw new AppError(httpStatus.BAD_REQUEST, query.error.issues[0].message);
	}

	const result = await utilityService.listUtilities(getUser(req), query.data);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Utility bills fetched successfully",
		data: result,
	});
});

const createUtility = catchAsync(async (req: Request, res: Response) => {
	const result = await utilityService.createUtility(getUser(req), req.body);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Utility bill created successfully",
		data: result,
	});
});

const updateUtility = catchAsync(async (req: Request, res: Response) => {
	const result = await utilityService.updateUtility(
		getUser(req),
		req.params.id as string,
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Utility bill updated successfully",
		data: result,
	});
});

const setUtilityPaid = catchAsync(async (req: Request, res: Response) => {
	const result = await utilityService.setUtilityPaid(
		getUser(req),
		req.params.id as string,
		req.body.isPaid,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: result.bill.isPaid
			? "Utility bill marked as paid"
			: "Utility bill marked as unpaid",
		data: result,
	});
});

const deleteUtility = catchAsync(async (req: Request, res: Response) => {
	const result = await utilityService.deleteUtility(
		getUser(req),
		req.params.id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Utility bill deleted successfully",
		data: result,
	});
});

export const utilityController = {
	listUtilities,
	createUtility,
	updateUtility,
	setUtilityPaid,
	deleteUtility,
};
