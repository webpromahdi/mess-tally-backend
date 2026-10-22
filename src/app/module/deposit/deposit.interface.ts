import type { MemberStatus } from "../../../generated/prisma/enums";
import type { IMonthContext } from "../messMonth/month.interface";

export interface IDepositEntry {
	id: string;
	memberId: string;
	memberName: string;
	memberStatus: MemberStatus;
	amount: number;
	date: string;
	note: string | null;
	receivedById: string;
	receivedByName: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface IDepositMemberTotal {
	memberId: string;
	name: string;
	status: MemberStatus;
	count: number;
	amount: number;
}

export interface IDepositListResult {
	month: IMonthContext;
	deposits: IDepositEntry[];
	total: number;
	byMember: IDepositMemberTotal[];
}

export interface IDepositEntryResult {
	deposit: IDepositEntry;
}

export interface IDeleteDepositResult {
	id: string;
	deleted: true;
}
