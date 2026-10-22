import { z } from "zod";

/**
 * `YYYY-MM`. The exact calendar validation (month 13, year range) happens in
 * `parseMonthParam`, which returns a 400 with the same message.
 */
export const monthParamSchema = z
	.string()
	.trim()
	.regex(
		/^\d{4}-\d{2}$/,
		"Month must be in YYYY-MM format (for example 2026-10).",
	);

export const openMonthSchema = z.object({
	month: monthParamSchema,
});

export type TOpenMonthPayload = z.infer<typeof openMonthSchema>;
