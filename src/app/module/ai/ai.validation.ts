import { z } from "zod";

export const chatSchema = z.object({
	messages: z
		.array(
			z.object({
				role: z.enum(["user", "assistant"]),
				content: z
					.string()
					.trim()
					.min(1, "Message cannot be empty.")
					.max(1000, "Message can be at most 1000 characters."),
			}),
		)
		.min(1, "Send at least one message.")
		.max(20, "Send at most 20 messages.")
		.refine(
			(messages) => messages[messages.length - 1].role === "user",
			"The last message must be from the user.",
		),
});

export type TChatPayload = z.infer<typeof chatSchema>;
