import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { AppError } from "../../utils/AppError";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "../auth/auth.interface";
import { subscriptionService } from "./subscription.service";
import { activateSubscriptionSchema } from "./subscription.validation";

const getUser = (req: Request): IRequestUser => {
	if (!req.user) throw new AppError(httpStatus.UNAUTHORIZED, "User information is missing in the request");
	return req.user;
};

const getSubscription = catchAsync(async (req: Request, res: Response) => {
	sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Subscription fetched successfully", data: await subscriptionService.getSubscription(getUser(req)) });
});

const activateSubscription = catchAsync(async (req: Request, res: Response) => {
	const parsed = activateSubscriptionSchema.safeParse(req.body);
	if (!parsed.success) throw new AppError(httpStatus.BAD_REQUEST, parsed.error.issues[0].message);
	sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "bKash payment created successfully", data: await subscriptionService.activateSubscription(getUser(req), parsed.data) });
});

const listPayments = catchAsync(async (req: Request, res: Response) => {
	sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Subscription payments fetched successfully", data: await subscriptionService.listPayments(getUser(req)) });
});

const paymentCallback = catchAsync(async (req: Request, res: Response) => {
	try {
		res.redirect(
			httpStatus.FOUND,
			await subscriptionService.paymentCallback(req.query),
		);
	} catch (error) {
		console.error("[subscription] bKash callback failed", error);
		res.redirect(
			httpStatus.FOUND,
			subscriptionService.callbackErrorRedirect(req.query),
		);
	}
});

const reconcilePayment = catchAsync(async (req: Request, res: Response) => {
	const payment = await subscriptionService.reconcilePayment(
		getUser(req),
		req.params.id as string,
	);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Subscription payment reconciled successfully",
		data: payment,
	});
});

export const subscriptionController = {
	getSubscription,
	activateSubscription,
	listPayments,
	paymentCallback,
	reconcilePayment,
};
