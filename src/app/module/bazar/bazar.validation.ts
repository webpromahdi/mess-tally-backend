import { z } from "zod";
import { dateOnlySchema } from "../../utils/dateSchema";
import { moneyAmountSchema } from "../../utils/money";
import { monthParamSchema } from "../messMonth/month.validation";

const memberIdSchema = z.uuid("Invalid member id.");

const bazarFields = {
	title: z
		.string()
		.trim()
		.max(120, "Title can be at most 120 characters.")
		.optional(),
	items: z
		.string()
		.trim()
		.max(1000, "Items can be at most 1000 characters.")
		.nullable()
		.optional(),
	amount: moneyAmountSchema,
	bazarDate: dateOnlySchema,
	shopperId: memberIdSchema,
};

export const createBazarSchema = z.object(bazarFields);

/**
 * `PATCH` accepts any subset of the editable fields. `addedById` and
 * `paidFromMessFund` are deliberately absent.
 */
export const updateBazarSchema = z
	.object(bazarFields)
	.partial()
	.refine(
		(data) => Object.values(data).some((value) => value !== undefined),
		"Provide at least one field to update.",
	);

export const bazarListQuerySchema = z
	.object({
		month: monthParamSchema.optional(),
		shopperId: memberIdSchema.optional(),
		from: dateOnlySchema.optional(),
		to: dateOnlySchema.optional(),
	})
	.refine(
		(query) => !query.from || !query.to || query.from <= query.to,
		"`from` must be on or before `to`.",
	);

export type TCreateBazarPayload = z.infer<typeof createBazarSchema>;
export type TUpdateBazarPayload = z.infer<typeof updateBazarSchema>;
export type TBazarListQuery = z.infer<typeof bazarListQuerySchema>;
