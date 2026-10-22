import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../utils/AppError";
import { catchAsync } from "../utils/catchAsync";

declare global {
	namespace Express {
		interface Request {
			messId?: string;
		}
	}
}

export const requireMess = catchAsync(
	async (req: Request, _res: Response, next: NextFunction) => {
		const messId = req.user?.messId;

		if (!messId) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"No active mess selected. Please select a mess first.",
			);
		}

		req.messId = messId;
		next();
	},
);
