import { z } from "zod";
import {
	UtilityCategory,
	UtilitySplitType,
} from "../../../generated/prisma/enums";
import { dateOnlySchema } from "../../utils/dateSchema";
import { moneyAmountSchema } from "../../utils/money";
import { monthParamSchema } from "../messMonth/month.validation";

const categorySchema = z.enum(UtilityCategory, {
	error: "Invalid utility category.",
});

const titleSchema = z
	.string()
	.trim()
	.min(1, "Title is required.")
	.max(120, "Title can be at most 120 characters.");

const notesSchema = z
	.string()
	.trim()
	.max(500, "Notes can be at most 500 characters.")
	.nullable();

const splitTypeSchema = z
	.enum(UtilitySplitType, { error: "Invalid split type." })
	.refine(
		(value) => value === UtilitySplitType.EQUAL,
		"CUSTOM_WEIGHT split is not supported yet.",
	);

const utilityFields = {
	category: categorySchema,
	title: titleSchema,
	amount: moneyAmountSchema,
	splitType: splitTypeSchema,
	dueDate: dateOnlySchema.nullable(),
	notes: notesSchema,
};

export const createUtilitySchema = z.object({
	...utilityFields,
	month: monthParamSchema,
	category: categorySchema.optional(),
	splitType: splitTypeSchema.optional(),
	dueDate: dateOnlySchema.nullable().optional(),
	notes: notesSchema.optional(),
});

/**
 * `month`, `isPaid`, `paidAt`, `paidById`, `paymentId` and `receiptUrl` are
 * intentionally absent: a bill stays in its month and payment state changes
 * only through `PATCH /:id/paid`.
 */
export const updateUtilitySchema = z
	.object(utilityFields)
	.partial()
	.refine(
		(data) => Object.values(data).some((value) => value !== undefined),
		"Provide at least one field to update.",
	);

export const utilityPaidSchema = z.object({
	isPaid: z.boolean({ error: "`isPaid` must be true or false." }),
});

export const utilityListQuerySchema = z.object({
	month: monthParamSchema.optional(),
});

export type TCreateUtilityPayload = z.infer<typeof createUtilitySchema>;
export type TUpdateUtilityPayload = z.infer<typeof updateUtilitySchema>;
export type TUtilityPaidPayload = z.infer<typeof utilityPaidSchema>;
export type TUtilityListQuery = z.infer<typeof utilityListQuerySchema>;
