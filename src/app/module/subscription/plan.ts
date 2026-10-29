import { MessPlan, type PaymentType } from "../../../generated/prisma/enums";
import type { Mess } from "../../../generated/prisma/client";
import config from "../../config";
import { AppError } from "../../utils/AppError";
import { addDays } from "../../utils/time";

export const FREE_ACTIVE_MEMBER_LIMIT = 5;

export type TPlanKey = "MONTHLY" | "HALF_YEARLY" | "YEARLY";

export interface IBkashPlanOption {
	key: TPlanKey;
	label: string;
	durationDays: number;
	price: number;
	currency: string;
	type: PaymentType;
}

const positivePrice = (value: number, fallback: number): number =>
	Number.isFinite(value) && value > 0 ? value : fallback;

/**
 * The three purchasable PRO durations. Durations are whole days (30/180/365)
 * so renewals never drift across calendar-month length quirks.
 */
export const PLAN_OPTIONS: Record<TPlanKey, IBkashPlanOption> = {
	MONTHLY: {
		key: "MONTHLY",
		label: "1 Month",
		durationDays: 30,
		price: positivePrice(config.pro_price_1_month, 100),
		currency: "BDT",
		type: "SUBSCRIPTION_MONTHLY" as PaymentType,
	},
	HALF_YEARLY: {
		key: "HALF_YEARLY",
		label: "6 Months",
		durationDays: 180,
		price: positivePrice(config.pro_price_6_month, 500),
		currency: "BDT",
		type: "SUBSCRIPTION_HALF_YEARLY" as PaymentType,
	},
	YEARLY: {
		key: "YEARLY",
		label: "1 Year",
		durationDays: 365,
		price: positivePrice(config.pro_price_12_month, 1000),
		currency: "BDT",
		type: "SUBSCRIPTION_YEARLY" as PaymentType,
	},
};

export const planOptionList = (): IBkashPlanOption[] =>
	Object.values(PLAN_OPTIONS);

export const getPlanOption = (key: string): IBkashPlanOption | null => {
	const option = PLAN_OPTIONS[key as TPlanKey];

	return option ?? null;
};

/**
 * PRO is active only while `planExpiresAt` is in the future. No grace period:
 * the moment the timestamp passes, the mess is back on FREE.
 */
export const isProActive = (
	mess: Pick<Mess, "plan" | "planExpiresAt">,
	now = new Date(),
): boolean =>
	mess.plan === MessPlan.PRO &&
	Boolean(mess.planExpiresAt) &&
	mess.planExpiresAt!.getTime() > now.getTime();

export interface IPlanAccess {
	plan: "FREE" | "PRO";
	isPro: boolean;
	planExpiresAt: Date | null;
	limits: { maxActiveMembers: number | null };
	features: {
		bazarReceiptUploads: boolean;
		selfServiceMeals: boolean;
		pastMonthArchives: boolean;
		pdfStatements: boolean;
	};
}

/** Single source of truth for every plan gate and the frontend feature flags. */
export const getPlanAccess = (
	mess: Pick<Mess, "plan" | "planExpiresAt">,
): IPlanAccess => {
	const isPro = isProActive(mess);

	return {
		plan: isPro ? "PRO" : "FREE",
		isPro,
		planExpiresAt: mess.planExpiresAt,
		limits: { maxActiveMembers: isPro ? null : FREE_ACTIVE_MEMBER_LIMIT },
		features: {
			bazarReceiptUploads: isPro,
			selfServiceMeals: isPro,
			pastMonthArchives: isPro,
			pdfStatements: isPro,
		},
	};
};

/**
 * Throws 402 when a PRO-only feature is used by a FREE (or expired) mess.
 * `feature` is a human label used in the error message.
 */
export const assertProAccess = (
	mess: Pick<Mess, "plan" | "planExpiresAt">,
	feature: string,
): void => {
	if (!isProActive(mess)) {
		throw new AppError(
			402,
			`${feature} is a PRO feature. Ask your mess manager to activate PRO subscription.`,
		);
	}
};

/** The next PRO window for a payment. Early renewals start at the current expiry. */
export const nextProPeriod = (
	mess: Pick<Mess, "plan" | "planExpiresAt">,
	durationDays: number,
	now = new Date(),
): { periodStart: Date; periodEnd: Date } => {
	const periodStart =
		isProActive(mess, now) ? mess.planExpiresAt! : now;

	return { periodStart, periodEnd: addDays(periodStart, durationDays) };
};

export const formatMoney = (value: number): string => value.toFixed(2);
