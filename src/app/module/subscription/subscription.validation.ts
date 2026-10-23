import { z } from "zod";

export const activateSubscriptionSchema = z.object({
	plan: z.enum(["MONTHLY", "HALF_YEARLY", "YEARLY"]),
});

export type TActivateSubscriptionPayload = z.infer<
	typeof activateSubscriptionSchema
>;
