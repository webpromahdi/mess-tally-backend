import type { Request, Response } from "express";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "../auth/auth.interface";
import { buildSummaryCsv } from "./summary.export";
import { summaryService } from "./summary.service";
import {
	summaryExportQuerySchema,
	summaryQuerySchema,
} from "./summary.validation";

const getUser = (req: Request): IRequestUser => {
	if (!req.user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User information is missing in the request",
		);
	}

	return req.user;
};

const getSummary = catchAsync(async (req: Request, res: Response) => {
	const query = summaryQuerySchema.safeParse(req.query);

	if (!query.success) {
		throw new AppError(httpStatus.BAD_REQUEST, query.error.issues[0].message);
	}

	const result = await summaryService.getSummary(
		getUser(req),
		query.data.month,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Summary fetched successfully",
		data: result,
	});
});

const exportSummary = catchAsync(async (req: Request, res: Response) => {
	const query = summaryExportQuerySchema.safeParse(req.query);

	if (!query.success) {
		throw new AppError(httpStatus.BAD_REQUEST, query.error.issues[0].message);
	}

	const result = await summaryService.getSummary(
		getUser(req),
		query.data.month,
	);

	if (query.data.format === "json") {
		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Summary exported successfully",
			data: result,
		});
		return;
	}

	res.setHeader("Content-Type", "text/csv; charset=utf-8");
	res.setHeader(
		"Content-Disposition",
		`attachment; filename="mess-tally-summary-${result.month.name}.csv"`,
	);
	res.status(httpStatus.OK).send(`\uFEFF${buildSummaryCsv(result)}`);
});

export const summaryController = {
	getSummary,
	exportSummary,
};
