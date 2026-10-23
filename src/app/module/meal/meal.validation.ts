import { z } from "zod";
import { monthParamSchema } from "../messMonth/month.validation";
import { parseDateOnly } from "../messMonth/month.util";

const dateOnlySchema = z
	.string()
	.trim()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.")
	.refine((value) => {
		try {
			parseDateOnly(value);
			return true;
		} catch {
			return false;
		}
	}, "Date must be a valid calendar date.");

/**
 * `z.coerce` keeps HTML form payloads (numeric strings) working while still
 * rejecting null, empty strings, negatives, NaN and Infinity. Meals may be
 * fractional (0.5).
 */
export const mealCountSchema = z.preprocess(
	(value) =>
		value === null || value === undefined || value === "" ? Number.NaN : value,
	z.coerce
		.number()
		.refine((value) => Number.isFinite(value), "Meal counts must be numbers.")
		.refine((value) => value >= 0, "Meal counts cannot be negative."),
);

const memberIdSchema = z.uuid("Invalid member id.");

/**
 * `PUT /api/meals` replaces the whole cell, so all four counts are required.
 * This prevents a partial payload from silently zeroing untouched meals.
 */
export const upsertMealSchema = z.object({
	memberId: memberIdSchema,
	date: dateOnlySchema,
	breakfast: mealCountSchema,
	lunch: mealCountSchema,
	dinner: mealCountSchema,
	guestMeals: mealCountSchema,
});

const bulkEntrySchema = z.object({
	memberId: memberIdSchema,
	breakfast: mealCountSchema,
	lunch: mealCountSchema,
	dinner: mealCountSchema,
	guestMeals: mealCountSchema,
});

/**
 * One daily sheet in one transaction. The shared `date` is what makes the
 * bulk operation a single-month write, so every entry lands in the same month.
 */
export const bulkUpsertMealSchema = z.object({
	date: dateOnlySchema,
	entries: z
		.array(bulkEntrySchema)
		.min(1, "Add at least one member to the meal entry.")
		.max(200, "A bulk meal entry can contain at most 200 members.")
		.refine(
			(entries) =>
				new Set(entries.map((entry) => entry.memberId)).size === entries.length,
			"Each member can appear only once in a bulk entry.",
		),
});

export const selfMealSchema = z
	.object({
		date: dateOnlySchema,
		breakfast: mealCountSchema.optional(),
		lunch: mealCountSchema.optional(),
		dinner: mealCountSchema.optional(),
		guestMeals: mealCountSchema.optional(),
	})
	.refine(
		(value) =>
			value.breakfast !== undefined ||
			value.lunch !== undefined ||
			value.dinner !== undefined ||
			value.guestMeals !== undefined,
		"At least one meal count is required.",
	);

export const mealGridQuerySchema = z.object({
	month: monthParamSchema.optional(),
});

export type TUpsertMealPayload = z.infer<typeof upsertMealSchema>;
export type TBulkUpsertMealPayload = z.infer<typeof bulkUpsertMealSchema>;
export type TMealGridQuery = z.infer<typeof mealGridQuerySchema>;
export type TSelfMealPayload = z.infer<typeof selfMealSchema>;
