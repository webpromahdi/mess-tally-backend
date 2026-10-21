import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { profileService } from "./profile.service";

const uploadProfileImage = catchAsync(async (req: Request, res: Response) => {
	if (!req.file) {
		throw new AppError(httpStatus.BAD_REQUEST, "No file uploaded");
	}
	const userId = req.user?.userId as string;
	const result = await profileService.uploadProfileImage(req.file?.buffer, userId);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Profile image uploaded successfully",
		data: result,
	});
});

export const UserController = {
	uploadProfileImage,
};