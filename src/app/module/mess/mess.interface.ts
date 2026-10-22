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
