import type { MemberStatus, MessRole } from "../../../generated/prisma/enums";

/**
 * One row of `GET /api/mess/members` and `GET /api/mess/members/pending`.
 * The user identity (name, email, avatar) lives on `user`, the mess-scoped
 * permissions (role, isManager) and lifecycle (status, joinedAt, leftAt) live
 * on the `mess_member` row.
 */
export interface IMemberListItem {
	id: string;
	userId: string;
	name: string;
	email: string;
	avatarUrl: string | null;
	role: MessRole;
	status: MemberStatus;
	isManager: boolean;
	rentShare: number;
	fixedRentAmount: number | null;
	joinedAt: Date;
	leftAt: Date | null;
}

export interface IMemberListResult {
	members: IMemberListItem[];
	total: number;
}

/**
 * Result of `POST /api/mess/leave`. The active mess pointer is always cleared
 * because leaving is the only way to switch messes (decision D7/D14).
 */
export interface ILeaveMessResult {
	messId: string;
	leftAt: Date;
	activeMessId: null;
}

export interface IRemoveMemberResult {
	id: string;
	deleted: true;
}
