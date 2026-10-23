import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "../auth/auth.interface";
import { mealService } from "./meal.service";
import { mealGridQuerySchema } from "./meal.validation";

const getUser = (req: Request): IRequestUser => {
	if (!req.user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	return req.user;
};

const getMealGrid = catchAsync(async (req: Request, res: Response) => {
	const query = mealGridQuerySchema.safeParse(req.query);

	if (!query.success) {
		throw new AppError(httpStatus.BAD_REQUEST, query.error.issues[0].message);
	}

	const result = await mealService.getMealGrid(getUser(req), query.data.month);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Meal grid fetched successfully",
		data: result,
	});
});

const upsertMeal = catchAsync(async (req: Request, res: Response) => {
	const result = await mealService.upsertMeal(getUser(req), req.body);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Meal entry saved successfully",
		data: result,
	});
});

const bulkUpsertMeals = catchAsync(async (req: Request, res: Response) => {
	const result = await mealService.bulkUpsertMeals(getUser(req), req.body);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Meal entries saved successfully",
		data: result,
	});
});

const deleteMeal = catchAsync(async (req: Request, res: Response) => {
	const result = await mealService.deleteMeal(
		getUser(req),
		req.params.id as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Meal entry deleted successfully",
		data: result,
	});
});

const updateOwnMeal = catchAsync(async (req: Request, res: Response) => {
	const result = await mealService.updateOwnMeal(getUser(req), req.body);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Your meal entry was saved successfully",
		data: result,
	});
});

export const mealController = {
	getMealGrid,
	upsertMeal,
	bulkUpsertMeals,
	deleteMeal,
	updateOwnMeal,
};
