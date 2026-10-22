import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import jwt from "jsonwebtoken";
import multer from "multer";
import { Prisma } from "../../generated/prisma/client";
import config from "../config";
import { AppError } from "../utils/AppError";

/**
 * Connection-level failures raised by the pg driver adapter (raw socket codes)
 * or by Prisma itself. They say nothing about the request, so the right answer
 * is `503` + "retry", not a generic `500`.
 */
const TRANSIENT_DB_ERROR_CODES = new Set([
	"ETIMEDOUT",
	"ECONNRESET",
	"ECONNREFUSED",
	"ENOTFOUND",
	"EAI_AGAIN",
	"EPIPE",
	"P1001",
	"P1002",
	"P1008",
	"P1017",
	"P2024",
]);

export const globalErrorHandler = async (
	err: any,
	_req: Request,
	res: Response,
	_next: NextFunction,
) => {
	// if (config.node_env === "development") {
	console.log("Error from Global Error Handler", err);
	// }

	let statusCode: number = httpStatus.INTERNAL_SERVER_ERROR;
	let errorMessage = err.message || "Internal Server Error";
	const errorName = err.name || "Internal Server Error";
	// let errorDetails = err.stack

	if (err instanceof Prisma.PrismaClientValidationError) {
		statusCode = httpStatus.BAD_REQUEST;
		errorMessage = "You have provided incorrect field type or missing fields";
	} else if (err instanceof Prisma.PrismaClientKnownRequestError) {
		if (TRANSIENT_DB_ERROR_CODES.has(err.code)) {
			statusCode = httpStatus.SERVICE_UNAVAILABLE;
			errorMessage =
				"The database is temporarily unavailable. Please try again in a moment.";
		} else if (err.code === "P2002") {
			(statusCode = httpStatus.BAD_REQUEST),
				(errorMessage = "Duplicate Key Error");
		} else if (err.code === "P2003") {
			(statusCode = httpStatus.BAD_REQUEST),
				(errorMessage = "Foreign key constraint failed");
		} else if (err.code === "P2025") {
			(statusCode = httpStatus.BAD_REQUEST),
				(errorMessage =
					"An operation failed because it depends on one or more records that were required but not found.");
		}
	} else if (err instanceof Prisma.PrismaClientInitializationError) {
		if (err.errorCode === "P1000") {
			statusCode = httpStatus.UNAUTHORIZED;
			errorMessage =
				"Authentication failed against database server. Please Check Your Credentials";
		} else if (err.errorCode === "P1001") {
			statusCode = httpStatus.SERVICE_UNAVAILABLE;
			errorMessage = "Can't reach database server";
		}
	} else if (err instanceof Prisma.PrismaClientUnknownRequestError) {
		statusCode = httpStatus.INTERNAL_SERVER_ERROR;
		errorMessage = "Error occurred during query execution";
	} else if (err instanceof AppError) {
		errorMessage = err.message;
		statusCode = err.statusCode;
	} else if (err instanceof multer.MulterError) {
		if (err.code === "LIMIT_FILE_SIZE") {
			statusCode = httpStatus.REQUEST_ENTITY_TOO_LARGE;
			errorMessage = "Image must be 5 MB or smaller";
		} else {
			statusCode = httpStatus.BAD_REQUEST;
			errorMessage = err.message;
		}
	} else if (err instanceof jwt.TokenExpiredError) {
		statusCode = httpStatus.UNAUTHORIZED;
		errorMessage = "Your session has expired. Please log in again.";
	} else if (err instanceof jwt.JsonWebTokenError) {
		statusCode = httpStatus.UNAUTHORIZED;
		errorMessage = "Invalid access token. Please log in again.";
	} else if (err instanceof Error) {
		errorMessage = err.message;
	}

	res.status(statusCode).json({
		success: false,
		statusCode: statusCode || httpStatus.INTERNAL_SERVER_ERROR,
		name:
			config.node_env === "development" ? errorName : "Internal Server Error",
		message:
			config.node_env === "development"
				? errorMessage
				: "Internal Server Error",
		error: config.node_env === "development" ? err : undefined,
		stack: config.node_env === "development" ? err.stack : undefined,
	});
};
