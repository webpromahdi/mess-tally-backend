import { z } from "zod";
import { MemberStatus } from "../../../generated/prisma/enums";

/**
 * `GET /api/mess/members?status=ACTIVE` - the status filter is optional and is
 * used by the frontend to fill meal/bazar/utility member dropdowns (AC 2.1.2).
 */
export const memberListQuerySchema = z.object({
	status: z.enum(MemberStatus, { error: "Invalid member status" }).optional(),
});

export type TMemberListQuery = z.infer<typeof memberListQuerySchema>;
