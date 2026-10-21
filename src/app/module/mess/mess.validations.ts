import { z } from "zod";

export const joinMessSchema = z.object({
	roomCode: z
		.string({ error: "Room code is required" })
		.trim()
		.min(1, "Room code is required")
		.max(64, "Room code is too long"),
});

export type TJoinMess = z.infer<typeof joinMessSchema>;
