import httpStatus from "http-status";
import crypto from "node:crypto";
import { MessPlan, PaymentStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import {
	createBkashPayment,
	executeBkashPayment,
	isBkashCompleted,
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

type TCallbackResult = "success" | "pending" | "failure" | "cancel";

/**
 * A bKash checkout that was never completed (the customer closed the tab, the
 * callback got lost, ...) would otherwise block every future activation with a
 * 409. Checkouts live for minutes, so old pending rows are released.
 */
const PENDING_PAYMENT_TTL_MS = 30 * 60_000;

interface IStoredPayment {
	amount: unknown;
	currency: string;
	merchantInvoiceNumber: string;
	bkashPaymentId: string | null;
}

const readString = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

const getSubscription = async (user: IRequestUser) => {
	const actor = await requireActiveMembership(user.userId);
	return {
		...getPlanAccess(actor.mess),
		options: Object.values(PLAN_OPTIONS).map(
			({ key, label, durationDays, price, currency }) => ({
				key,
				label,
				durationDays,
				price,
				currency,
			}),
		),
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

	await prisma.payment.updateMany({
		where: {
			messId: mess.id,
			status: PaymentStatus.PENDING,
			createdAt: { lt: new Date(Date.now() - PENDING_PAYMENT_TTL_MS) },
		},
		data: { status: PaymentStatus.FAILED },
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
	result: TCallbackResult,
	ids: { paymentId?: string; gatewayPaymentId?: string } = {},
): string => {
	const url = new URL(config.frontend_billing_path, config.frontend_url);
	url.searchParams.set("payment", result);
	if (ids.paymentId) url.searchParams.set("paymentId", ids.paymentId);
	if (ids.gatewayPaymentId) {
		url.searchParams.set("gatewayPaymentId", ids.gatewayPaymentId);
	}
	return url.toString();
};

/**
 * Compares the gateway answer with the checkout we created. Returns a human
 * readable reason when they disagree, or null when the payment is safe to
 * mark as PAID. Fields bKash omits in some responses are only compared when
 * present, but the amount and the transaction id are always required.
 */
const gatewayMismatch = (
	payment: IStoredPayment,
	gateway: TBkashResult,
): string | null => {
	const gatewayAmount = Number(gateway.amount);
	if (!Number.isFinite(gatewayAmount)) {
		return "bKash did not return a payable amount.";
	}
	if (gatewayAmount !== Number(payment.amount)) {
		return "bKash amount does not match the subscription payment.";
	}
	if (typeof gateway.trxID !== "string" || gateway.trxID.length === 0) {
		return "bKash did not return a transaction id.";
	}
	if (
		gateway.paymentID !== undefined &&
		gateway.paymentID !== payment.bkashPaymentId
	) {
		return "bKash paymentID does not match the stored checkout.";
	}
	if (
		gateway.merchantInvoiceNumber !== undefined &&
		gateway.merchantInvoiceNumber !== payment.merchantInvoiceNumber
	) {
		return "bKash merchantInvoiceNumber does not match the stored checkout.";
	}
	if (gateway.currency !== undefined && gateway.currency !== payment.currency) {
		return "bKash currency does not match the stored checkout.";
	}
	return null;
};

/**
 * Idempotent completion of a bKash checkout: verifies the gateway answer, then
 * records the transaction id, the PRO coverage window and the mess plan in one
 * transaction. Safe to call from the browser callback and the status endpoint.
 */
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
		return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
	}

	// The customer has not finished at the gateway yet (the status endpoint can
	// be polled while the bKash app is still open). Keep it PENDING, that is
	// data rather than an error.
	if (!isBkashCompleted(gatewayResponse)) {
		return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
	}

	const mismatch = gatewayMismatch(payment, gatewayResponse);
	if (mismatch) {
		// Keep the raw answer so a failed verification can be investigated.
		await prisma.payment.update({
			where: { id: payment.id },
			data: { gatewayResponse },
		});
		throw new AppError(httpStatus.BAD_GATEWAY, mismatch);
	}

	return prisma.$transaction(async (tx) => {
		const mess = await tx.mess.findUniqueOrThrow({
			where: { id: payment.messId },
			select: { id: true, plan: true, planExpiresAt: true },
		});
		const period = nextProPeriod(mess, payment.durationDays);

		// Claim and record in ONE statement: the payments_paid_at_consistent CHECK
		// requires status = PAID and paidAt to arrive together, and a single
		// conditional update also means only one concurrent callback can win, so
		// the PRO window is never extended twice for the same charge.
		const claimed = await tx.payment.updateMany({
			where: {
				id: payment.id,
				status: { notIn: [PaymentStatus.PAID, PaymentStatus.REFUNDED] },
			},
			data: {
				status: PaymentStatus.PAID,
				paidAt: new Date(),
				bkashTrxId: gatewayResponse.trxID as string,
				periodStart: period.periodStart,
				periodEnd: period.periodEnd,
				gatewayResponse,
			},
		});
		if (claimed.count === 0) {
			return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
		}

		await tx.mess.update({
			where: { id: mess.id },
			data: { plan: MessPlan.PRO, planExpiresAt: period.periodEnd },
		});

		return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
	});
};

/** Never downgrade a completed payment because a repeated callback says failed. */
const releasePendingPayment = async (
	paymentId: string,
	status: PaymentStatus,
): Promise<void> => {
	await prisma.payment.updateMany({
		where: { id: paymentId, status: PaymentStatus.PENDING },
		data: { status },
	});
};

/**
 * Best-effort trace of a failed finalize. The finalize transaction rolls back,
 * so the gateway answer and the reason have to be written separately or the
 * failure leaves no evidence at all in the database.
 */
const recordGatewayFailure = async (
	paymentId: string,
	gatewayResponse: TBkashResult,
	error: unknown,
): Promise<void> => {
	try {
		await prisma.payment.update({
			where: { id: paymentId },
			data: {
				gatewayResponse: {
					...gatewayResponse,
					_lastError: error instanceof Error ? error.message : String(error),
					_lastErrorAt: new Date().toISOString(),
				},
			},
		});
	} catch (writeError) {
		console.error(
			"[subscription] could not store bKash failure details",
			writeError,
		);
	}
};

const paymentCallback = async (
	query: Record<string, unknown>,
): Promise<string> => {
	// bKash sends `paymentID`; the casing has varied between API versions.
	const gatewayPaymentId =
		readString(query.paymentID) ?? readString(query.paymentId);
	const status = readString(query.status);

	if (!gatewayPaymentId || !status) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Missing bKash callback parameters.",
		);
	}

	const payment = await prisma.payment.findUnique({
		where: { bkashPaymentId: gatewayPaymentId },
		select: { id: true, status: true },
	});
	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Subscription payment not found.");
	}

	const ids = { paymentId: payment.id, gatewayPaymentId };

	if (status !== "success") {
		await releasePendingPayment(
			payment.id,
			status === "cancel" ? PaymentStatus.CANCELLED : PaymentStatus.FAILED,
		);
		return frontendRedirect(status === "cancel" ? "cancel" : "failure", ids);
	}

	let gatewayResponse: TBkashResult;
	try {
		gatewayResponse = await executeBkashPayment(gatewayPaymentId);
	} catch (error) {
		// executePayment can fail even though the customer was charged (duplicate
		// execute, timeout, expired token). Ask the gateway what really happened
		// before telling the user the payment failed.
		console.error(
			"[subscription] bKash executePayment failed, falling back to status query",
			error,
		);
		try {
			gatewayResponse = await queryBkashPayment(gatewayPaymentId);
		} catch (queryError) {
			console.error(
				"[subscription] bKash status query failed as well",
				queryError,
			);
			return frontendRedirect("failure", ids);
		}
	}

	try {
		const finalized = await finalizePayment(gatewayPaymentId, gatewayResponse);

		return frontendRedirect(
			finalized.status === PaymentStatus.PAID ? "success" : "pending",
			ids,
		);
	} catch (error) {
		console.error("[subscription] bKash payment finalize failed", error);
		await recordGatewayFailure(payment.id, gatewayResponse, error);
		return frontendRedirect("failure", ids);
	}
};

/**
 * Redirect used when the callback itself blew up, so the customer's browser
 * always lands on the billing page instead of a JSON error response.
 */
const callbackErrorRedirect = (query: Record<string, unknown>): string =>
	frontendRedirect(
		readString(query.status) === "cancel" ? "cancel" : "failure",
		{
			gatewayPaymentId:
				readString(query.paymentID) ?? readString(query.paymentId) ?? undefined,
		},
	);

const reconcilePayment = async (user: IRequestUser, paymentId: string) => {
	const actor = await requireActiveMembership(user.userId);
	const payment = await prisma.payment.findFirst({
		where: { id: paymentId, messId: actor.messId },
		select: { id: true, bkashPaymentId: true, status: true },
	});
	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Subscription payment not found.");
	}
	if (!payment.bkashPaymentId || payment.status === PaymentStatus.PAID) {
		return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
	}

	// A gateway answer that is not "Completed" keeps the row PENDING and is
	// reported as data instead of a 502, so the caller can keep polling.
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
			bkashTrxId: true,
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
	callbackErrorRedirect,
	reconcilePayment,
};
