import { z } from "zod";
import { dateOnlySchema } from "../../utils/dateSchema";
import { moneyAmountSchema } from "../../utils/money";
import { monthParamSchema } from "../messMonth/month.validation";

const memberIdSchema = z.uuid("Invalid member id.");

const depositFields = {
	memberId: memberIdSchema,
	amount: moneyAmountSchema,
	date: dateOnlySchema,
	note: z
		.string()
		.trim()
		.max(300, "Note can be at most 300 characters.")
		.nullable(),
};

export const createDepositSchema = z.object({
	...depositFields,
	date: dateOnlySchema.optional(),
	note: depositFields.note.optional(),
});

/**
 * `receivedById` is always the authenticated manager and is deliberately
 * absent. Changing `date` may move the deposit to another month.
 */
export const updateDepositSchema = z
	.object(depositFields)
	.partial()
	.refine(
		(data) => Object.values(data).some((value) => value !== undefined),
		"Provide at least one field to update.",
	);

export const depositListQuerySchema = z.object({
	month: monthParamSchema.optional(),
});

export type TCreateDepositPayload = z.infer<typeof createDepositSchema>;
export type TUpdateDepositPayload = z.infer<typeof updateDepositSchema>;
export type TDepositListQuery = z.infer<typeof depositListQuerySchema>;
