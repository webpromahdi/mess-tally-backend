import { z } from "zod";
import { parseDateOnly } from "../module/messMonth/month.util";

/**
 * Shared `YYYY-MM-DD` input schema. The regex is only the first gate; parsing
 * with `parseDateOnly` rejects impossible dates such as 2026-02-30.
 */
export const dateOnlySchema = z
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
