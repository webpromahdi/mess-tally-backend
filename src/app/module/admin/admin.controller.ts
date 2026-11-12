import type { Request, Response } from "express";
import httpStatus from "http-status";
import type { z } from "zod";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "../auth/auth.interface";
import { adminService } from "./admin.service";
import {
	adminMessListQuerySchema,
	adminRevenueQuerySchema,
	adminUserListQuerySchema,
} from "./admin.validation";

const getUser = (req: Request): IRequestUser => {
	if (!req.user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	return req.user;
};

const parseQuery = <T extends z.ZodType>(
	schema: T,
	req: Request,
): z.infer<T> => {
	const query = schema.safeParse(req.query);

	if (!query.success) {
		throw new AppError(httpStatus.BAD_REQUEST, query.error.issues[0].message);
	}

	return query.data;
};

const getOverview = catchAsync(async (_req: Request, res: Response) => {
	const result = await adminService.getOverview();

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Admin overview fetched successfully",
		data: result,
	});
});

const listUsers = catchAsync(async (req: Request, res: Response) => {
	const { users, meta } = await adminService.listUsers(
		parseQuery(adminUserListQuerySchema, req),
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Users fetched successfully",
		data: users,
		meta,
	});
});

const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
	const result = await adminService.updateUserStatus(
		getUser(req),
		String(req.params.id),
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message:
			result.status === "SUSPENDED"
				? "User suspended successfully"
				: "User reactivated successfully",
		data: result,
	});
});

const updateUserRole = catchAsync(async (req: Request, res: Response) => {
	const result = await adminService.updateUserRole(
		getUser(req),
		String(req.params.id),
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User role updated successfully",
		data: result,
	});
});

const listMesses = catchAsync(async (req: Request, res: Response) => {
	const { messes, meta } = await adminService.listMesses(
		parseQuery(adminMessListQuerySchema, req),
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Messes fetched successfully",
		data: messes,
		meta,
	});
});

const grantPro = catchAsync(async (req: Request, res: Response) => {
	const result = await adminService.grantPro(String(req.params.id), req.body);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "PRO granted successfully",
		data: result,
	});
});

const getRevenue = catchAsync(async (req: Request, res: Response) => {
	const { meta, ...result } = await adminService.getRevenue(
		parseQuery(adminRevenueQuerySchema, req),
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Revenue fetched successfully",
		data: result,
		meta,
	});
});

export const adminController = {
	getOverview,
	listUsers,
	updateUserStatus,
	updateUserRole,
	listMesses,
	grantPro,
	getRevenue,
};
