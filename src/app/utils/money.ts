import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import { round2 } from "../module/messMonth/month.util";

/**
 * Money input rule shared by bazar, utility bills and deposits.
 *
 * - `z.preprocess` stops `null` and `""` from coercing to 0.
 * - The last refine rejects more than 2 decimal places instead of silently
 *   rounding a value the user did not intend.
 */
export const moneyAmountSchema = z.preprocess(
	(value) =>
		value === null || value === undefined || value === "" ? Number.NaN : value,
	z.coerce
		.number()
		.refine((value) => Number.isFinite(value), "Amount must be a number.")
		.refine((value) => value > 0, "Amount must be greater than 0.")
		.refine((value) => value <= 99_999_999.99, "Amount is too large.")
		.refine(
			(value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
			"Amount can have at most 2 decimal places.",
		),
);

/** Prisma `Decimal` -> JSON number rounded to 2 decimals. */
export const toMoney = (value: Prisma.Decimal | number): number =>
	round2(Number(value));
