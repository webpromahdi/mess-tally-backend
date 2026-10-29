import { z } from "zod";

export const updateProfileSchema = z
	.object({
		bio: z
			.string({ error: "Bio must be a string" })
			.trim()
			.max(500, "Bio must be at most 500 characters")
			.optional(),
		phone: z
			.string({ error: "Phone must be a string" })
			.trim()
			.max(20, "Phone must be at most 20 characters")
			.regex(/^\+?[0-9\s()-]{6,20}$/, "Enter a valid phone number")
			.optional(),
		address: z
			.string({ error: "Address must be a string" })
			.trim()
			.max(255, "Address must be at most 255 characters")
			.optional(),
	})
	.refine((data) => Object.keys(data).length > 0, {
		message: "At least one field must be provided",
	});

export type TUpdateProfile = z.infer<typeof updateProfileSchema>;
