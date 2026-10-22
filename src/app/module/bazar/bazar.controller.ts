import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "../auth/auth.interface";
import { bazarService } from "./bazar.service";
import { bazarListQuerySchema } from "./bazar.validation";

const getUser = (req: Request): IRequestUser => {
	if (!req.user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	return req.user;
};

const listBazar = catchAsync(async (req: Request, res: Response) => {
	const query = bazarListQuerySchema.safeParse(req.query);

	if (!query.success) {
		throw new AppError(httpStatus.BAD_REQUEST, query.error.issues[0].message);
	}

	const result = await bazarService.listBazar(getUser(req), query.data);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Bazar entries fetched successfully",
		data: result,
	});
});

const createBazar = catchAsync(async (req: Request, res: Response) => {
	const result = await bazarService.createBazar(getUser(req), req.body);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Bazar entry created successfully",
		data: result,
	});
});

const updateBazar = catchAsync(async (req: Request, res: Response) => {
	const result = await bazarService.updateBazar(
		getUser(req),
		req.params.id as string,
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Bazar entry updated successfully",
		data: result,
	});
});

const deleteBazar = catchAsync(async (req: Request, res: Response) => {
	const result = await bazarService.deleteBazar(
		getUser(req),
		req.params.id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Bazar entry deleted successfully",
		data: result,
	});
});

export const bazarController = {
	listBazar,
	createBazar,
	updateBazar,
	deleteBazar,
};
