import { z } from "zod";
import { monthParamSchema } from "../messMonth/month.validation";

/**
 * `month` is optional and defaults to the current UTC month. The exact
 * calendar validation stays in `parseMonthParam`, which returns a 400.
 */
export const summaryQuerySchema = z.object({
	month: monthParamSchema.optional(),
});

export type TSummaryQuery = z.infer<typeof summaryQuerySchema>;
