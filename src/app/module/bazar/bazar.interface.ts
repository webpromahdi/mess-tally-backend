import type { IMonthContext } from "../messMonth/month.interface";

export interface IBazarEntry {
	id: string;
	title: string;
	items: string | null;
	amount: number;
	bazarDate: string;
	shopperId: string;
	shopperName: string;
	addedById: string;
	addedByName: string;
	paidFromMessFund: boolean;
	receiptUrl: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface IBazarShopperTotal {
	memberId: string;
	name: string;
	count: number;
	amount: number;
}

export interface IBazarListResult {
	month: IMonthContext;
	entries: IBazarEntry[];
	totals: {
		houseTotal: number;
		byShopper: IBazarShopperTotal[];
	};
}

export interface IBazarEntryResult {
	entry: IBazarEntry;
}

export interface IDeleteBazarResult {
	id: string;
	deleted: true;
}
