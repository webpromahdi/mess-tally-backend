import httpStatus from "http-status";
import crypto from "node:crypto";
import { PaymentStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import {
	createBkashPayment,
	executeBkashPayment,
	queryBkashPayment,
	type TBkashResult,
} from "../../lib/bkash";
import config from "../../config";
import type { IRequestUser } from "../auth/auth.interface";
import { assertManager, requireActiveMembership } from "../mess/mess.scope";
import {
	getPlanOption,
	getPlanAccess,
	nextProPeriod,
	PLAN_OPTIONS,
} from "./plan";
import type { TActivateSubscriptionPayload } from "./subscription.validation";

const getSubscription = async (user: IRequestUser) => {
	const actor = await requireActiveMembership(user.userId);
	return {
		...getPlanAccess(actor.mess),
		options: Object.values(PLAN_OPTIONS).map(({ key, label, durationDays, price, currency }) => ({
			key,
			label,
			durationDays,
			price,
			currency,
		})),
	};
};

const activateSubscription = async (
	user: IRequestUser,
	payload: TActivateSubscriptionPayload,
) => {
	const actor = assertManager(await requireActiveMembership(user.userId));
	const option = getPlanOption(payload.plan);
	if (!option) {
		throw new AppError(httpStatus.BAD_REQUEST, "Invalid subscription plan.");
	}

	const mess = await prisma.mess.findUniqueOrThrow({
		where: { id: actor.messId },
		select: { id: true, plan: true, planExpiresAt: true },
	});
	const pendingPayment = await prisma.payment.findFirst({
		where: { messId: mess.id, status: PaymentStatus.PENDING },
		select: { id: true },
	});

	if (pendingPayment) {
		throw new AppError(
			httpStatus.CONFLICT,
			"There is already a pending subscription payment for this mess.",
		);
	}

	const merchantInvoiceNumber = `SUB-${Date.now()}-${crypto.randomUUID()}`;
	const payment = await prisma.payment.create({
		data: {
			messId: mess.id,
			paidByMemberId: actor.id,
			type: option.type,
			status: PaymentStatus.PENDING,
			amount: option.price,
			currency: option.currency,
			durationDays: option.durationDays,
			paymentGateway: "bkash",
			merchantInvoiceNumber,
			payerReference: actor.userId,
		},
	});

	try {
		const gatewayResponse = await createBkashPayment({
			amount: option.price.toFixed(2),
			merchantInvoiceNumber,
			payerReference: actor.userId,
			callbackURL: config.bkash_callback_url,
		});
		const paymentURL = gatewayResponse.bkashURL;
		const paymentID = gatewayResponse.paymentID;

		if (typeof paymentURL !== "string" || typeof paymentID !== "string") {
			throw new AppError(
				httpStatus.BAD_GATEWAY,
				"bKash did not return a payment URL.",
			);
		}

		await prisma.payment.update({
			where: { id: payment.id },
			data: { bkashPaymentId: paymentID, gatewayResponse },
		});

		return { paymentId: payment.id, paymentURL };
	} catch (error) {
		await prisma.payment.update({
			where: { id: payment.id },
			data: { status: PaymentStatus.FAILED },
		});
		throw error;
	}
};

const frontendRedirect = (
	result: "success" | "failure" | "cancel",
	paymentId?: string,
): string => {
	const url = new URL(config.frontend_billing_path, config.frontend_url);
	url.searchParams.set("payment", result);
	if (paymentId) url.searchParams.set("paymentId", paymentId);
	return url.toString();
};

const finalizePayment = async (
	paymentID: string,
	gatewayResponse: TBkashResult,
) => {
	const payment = await prisma.payment.findUnique({
		where: { bkashPaymentId: paymentID },
		select: {
			id: true,
			messId: true,
			amount: true,
			currency: true,
			durationDays: true,
			status: true,
			merchantInvoiceNumber: true,
			bkashPaymentId: true,
		},
	});

	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Subscription payment not found.");
	}

	if (payment.status === PaymentStatus.PAID) {
		return payment;
	}

	const gatewayAmount = Number(gatewayResponse.amount);
	if (
		gatewayResponse.merchantInvoiceNumber !== payment.merchantInvoiceNumber ||
		gatewayResponse.paymentID !== payment.bkashPaymentId ||
		!Number.isFinite(gatewayAmount) ||
		gatewayAmount !== Number(payment.amount) ||
		gatewayResponse.currency !== payment.currency ||
		typeof gatewayResponse.trxID !== "string"
	) {
		throw new AppError(httpStatus.BAD_GATEWAY, "bKash payment verification failed.");
	}

	return prisma.$transaction(async (tx) => {
		const claimed = await tx.payment.updateMany({
			where: { id: payment.id, status: PaymentStatus.PENDING },
			data: { status: PaymentStatus.PAID },
		});
		if (claimed.count === 0) return payment;

		const mess = await tx.mess.findUniqueOrThrow({
			where: { id: payment.messId },
			select: { id: true, plan: true, planExpiresAt: true },
		});
		const period = nextProPeriod(mess, payment.durationDays);

		return tx.payment.update({
			where: { id: payment.id },
			data: {
				paidAt: new Date(),
				bkashTrxId: gatewayResponse.trxID,
				periodStart: period.periodStart,
				periodEnd: period.periodEnd,
				gatewayResponse,
			},
		}).then(async (updated) => {
			await tx.mess.update({
				where: { id: mess.id },
				data: { plan: "PRO", planExpiresAt: period.periodEnd },
			});
			return updated;
		});
	});
};

const paymentCallback = async (query: Record<string, unknown>): Promise<string> => {
	const paymentID = typeof query.paymentID === "string" ? query.paymentID : null;
	const status = typeof query.status === "string" ? query.status : null;
	if (!paymentID || !status) {
		throw new AppError(httpStatus.BAD_REQUEST, "Missing bKash callback parameters.");
	}

	const payment = await prisma.payment.findUnique({
		where: { bkashPaymentId: paymentID },
		select: { id: true },
	});
	if (!payment) throw new AppError(httpStatus.NOT_FOUND, "Subscription payment not found.");

	if (status !== "success") {
		await prisma.payment.update({
			where: { id: payment.id },
			data: { status: status === "cancel" ? PaymentStatus.CANCELLED : PaymentStatus.FAILED },
		});
		return frontendRedirect(status === "cancel" ? "cancel" : "failure", payment.id);
	}

	const gatewayResponse = await executeBkashPayment(paymentID);
	await finalizePayment(paymentID, gatewayResponse);
	return frontendRedirect("success", payment.id);
};

const reconcilePayment = async (user: IRequestUser, paymentId: string) => {
	const actor = await requireActiveMembership(user.userId);
	const payment = await prisma.payment.findFirst({
		where: { id: paymentId, messId: actor.messId },
		select: { id: true, bkashPaymentId: true, status: true },
	});
	if (!payment) throw new AppError(httpStatus.NOT_FOUND, "Subscription payment not found.");
	if (!payment.bkashPaymentId || payment.status === PaymentStatus.PAID) return payment;
	const gatewayResponse = await queryBkashPayment(payment.bkashPaymentId);
	return finalizePayment(payment.bkashPaymentId, gatewayResponse);
};

const listPayments = async (user: IRequestUser) => {
	const actor = await requireActiveMembership(user.userId);
	const rows = await prisma.payment.findMany({
		where: { messId: actor.messId },
		orderBy: { createdAt: "desc" },
		select: {
			id: true,
			type: true,
			status: true,
			amount: true,
			currency: true,
			durationDays: true,
			periodStart: true,
			periodEnd: true,
			paidAt: true,
			createdAt: true,
		},
	});
	return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
};

export const subscriptionService = {
	getSubscription,
	activateSubscription,
	listPayments,
	paymentCallback,
	reconcilePayment,
};
