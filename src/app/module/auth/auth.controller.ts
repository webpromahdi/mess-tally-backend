import type { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { authService } from "./auth.service";
import config from "../../config";
import { AppError } from "../../utils/AppError";
import type {
	TLoginUser,
	TRegisterUser,
	TVerifyEmail,
	TForgotPassword,
	TResetPassword,
} from "./auth.validation";
const registerUser = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body as TRegisterUser;

	const result = await authService.registerUser(payload);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Verification code sent to your email",
		data: result,
	});
});
const verifyEmail = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body as TVerifyEmail;

	const { user, accessToken, refreshToken } =
		await authService.verifyEmail(payload);

	res.cookie("accessToken", accessToken, {
		httpOnly: true,
		secure: config.node_env === "development" ? false : true,
		sameSite: config.node_env === "development" ? "lax" : "none",
		maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
	});
	res.cookie("refreshToken", refreshToken, {
		httpOnly: true,
		secure: config.node_env === "development" ? false : true,
		sameSite: config.node_env === "development" ? "lax" : "none",
		maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
	});

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Email verified successfully",
		data: {
			user,
			accessToken,
			refreshToken,
		},
	});
});
const loginUser = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body as TLoginUser;
	const result = await authService.loginUser(payload);
	const { accessToken, refreshToken } = result;
	res.cookie("accessToken", accessToken, {
		httpOnly: true,
		secure: config.node_env === "development" ? false : true,
		sameSite: config.node_env === "development" ? "lax" : "none",
		maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
	});
	res.cookie("refreshToken", refreshToken, {
		httpOnly: true,
		secure: config.node_env === "development" ? false : true,
		sameSite: config.node_env === "development" ? "lax" : "none",
		maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
	});
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User logged in successfully",
		data: result,
	});
});
const getMe = catchAsync(async (req: Request, res: Response) => {
	const user = req.user;

	if (!user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}
	const result = await authService.getMe(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User profile fetched successfully",
		data: result,
	});
});
const refreshToken = catchAsync(async (req: Request, res: Response) => {
	const token = req.cookies?.refreshToken;

	if (typeof token !== "string" || !token) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token is missing");
	}

	const result = await authService.refreshToken(token);
	const { accessToken, refreshToken: newRefreshToken } = result;

	res.cookie("accessToken", accessToken, {
		httpOnly: true,
		secure: config.node_env === "development" ? false : true,
		sameSite: config.node_env === "development" ? "lax" : "none",
		maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
	});
	res.cookie("refreshToken", newRefreshToken, {
		httpOnly: true,
		secure: config.node_env === "development" ? false : true,
		sameSite: config.node_env === "development" ? "lax" : "none",
		maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
	});

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "New tokens generated successfully",
		data: result,
	});
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body as TForgotPassword;

	await authService.forgotPassword(payload);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Password reset code sent to your email",
		data: null,
	});
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body as TResetPassword;

	await authService.resetPassword(payload);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Password reset successfully",
		data: null,
	});
});

export const authController = {
	registerUser,
	verifyEmail,
	loginUser,
	getMe,
	refreshToken,
	forgotPassword,
	resetPassword,
};
