import { z } from "zod";

const optionalText = z
	.string()
	.trim()
	.max(100, "Search text is too long.")
	.optional()
	.transform((value) => (value ? value : undefined));

const paginationFields = {
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
};

const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD.");

export const adminUserListQuerySchema = z.object({
	search: optionalText,
	mess: optionalText,
	role: z.enum(["USER", "ADMIN", "SUPERADMIN"]).optional(),
	status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "DELETED"]).optional(),
	...paginationFields,
});

export const adminMessListQuerySchema = z.object({
	search: optionalText,
	plan: z.enum(["FREE", "PRO"]).optional(),
	subscriptionType: z.enum(["MONTHLY", "HALF_YEARLY", "YEARLY"]).optional(),
	...paginationFields,
});

export const adminRevenueQuerySchema = z
	.object({
		from: isoDate.optional(),
		to: isoDate.optional(),
		...paginationFields,
	})
	.refine(
		(query) => !query.from || !query.to || query.from <= query.to,
		"`from` must be on or before `to`.",
	);

export const updateUserStatusSchema = z.object({
	status: z.enum(["ACTIVE", "SUSPENDED"]),
});

// SUPERADMIN is deliberately not assignable through the API.
export const updateUserRoleSchema = z.object({
	role: z.enum(["USER", "ADMIN"]),
});

export const grantProSchema = z.object({
	days: z.coerce
		.number()
		.int("Days must be a whole number.")
		.min(1, "Grant at least 1 day.")
		.max(730, "Grant at most 730 days at a time."),
});

export type TAdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
export type TAdminMessListQuery = z.infer<typeof adminMessListQuerySchema>;
export type TAdminRevenueQuery = z.infer<typeof adminRevenueQuerySchema>;
export type TUpdateUserStatus = z.infer<typeof updateUserStatusSchema>;
export type TUpdateUserRole = z.infer<typeof updateUserRoleSchema>;
export type TGrantPro = z.infer<typeof grantProSchema>;
