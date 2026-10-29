import type { Mess, MessMember } from "../../../generated/prisma/client";
import type { MemberStatus, MessRole } from "../../../generated/prisma/enums";

export interface ICreateMessPayload {
	name: string;
	address?: string;
	currency?: string;
	mealCutoffTime?: string;
	isJoinable?: boolean;
	requireApproval?: boolean;
}

export interface IJoinMessPayload {
	roomCode: string;
}

/**
 * The membership row returned by `requireActiveMembership`, with the mess it
 * belongs to. Services receive this instead of reading a `messId` from the JWT.
 */
export type TActiveMember = MessMember & { mess: Mess };

/**
 * One row of `GET /api/mess/my`: the caller's membership plus the mess summary.
 * `isActive` is true for the single mess pointed at by `user.activeMessId`.
 */
export interface IMyMess {
	membershipId: string;
	role: MessRole;
	status: MemberStatus;
	isManager: boolean;
	joinedAt: Date;
	leftAt: Date | null;
	isActive: boolean;
	mess: {
		id: string;
		name: string;
		address: string | null;
		currency: string;
		roomCode: string;
		isJoinable: boolean;
		requireApproval: boolean;
		mealCutoffTime: string;
	};
}
