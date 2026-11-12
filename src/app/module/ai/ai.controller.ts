import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { aiService } from "./ai.service";

const chat = catchAsync(async (req: Request, res: Response) => {
	if (!req.user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	const result = await aiService.chat(req.user, req.body.messages);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "TallyBot replied successfully",
		data: result,
	});
});

export const aiController = {
	chat,
};
