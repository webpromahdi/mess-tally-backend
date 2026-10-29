import { round2 } from "../messMonth/month.util";
import type {
	ISettlementMemberInput,
	ISettlementResult,
	ISettlementTransfer,
	ISettledBalance,
	TBalanceStatus,
} from "./summary.interface";

/**
 * Maximum discrepancy between the raw balances and a valid zero-sum ledger.
 * Full-precision balances from formulas 1-5 should sum to ~0 when there are
 * meals. A larger difference means the month cannot be settled at all (for
 * example, bazar exists but no meals were recorded).
 */
const BALANCE_TOLERANCE = 0.01;

interface IScaledBalance {
	index: number;
	memberId: string;
	floorCents: number;
	remainder: number;
	cents: number;
}

const balanceStatus = (cents: number): TBalanceStatus => {
	if (cents > 0) {
		return "RECEIVER";
	}

	if (cents < 0) {
		return "GIVER";
	}

	return "SETTLED";
};

/**
 * Converts raw balances to integer paise without losing the zero-sum
 * invariant. Each member moves by less than 0.01 from the full-precision
 * value; remainder cents go to the largest fractional parts first (stable on
 * the input order for ties).
 *
 * Returns `null` when the ledger is too far from zero to be a valid summary.
 */
const normalizeToCents = (
	members: ISettlementMemberInput[],
): IScaledBalance[] | null => {
	const scaled = members.map((member, index) => {
		const value = member.mealBalance * 100;
		const floorCents = Math.floor(value);

		return {
			index,
			memberId: member.memberId,
			floorCents,
			remainder: value - floorCents,
			cents: floorCents,
		};
	});

	const floorTotal = scaled.reduce((sum, row) => sum + row.floorCents, 0);
	const remainderCents = -floorTotal;

	// A valid zero-sum ledger adds at most one cent to each member. Anything
	// outside this range is not a rounding difference; it is a real imbalance.
	if (remainderCents < 0 || remainderCents > scaled.length) {
		return null;
	}

	const byRemainder = [...scaled].sort(
		(a, b) => b.remainder - a.remainder || a.index - b.index,
	);

	for (let index = 0; index < remainderCents; index += 1) {
		byRemainder[index].cents += 1;
	}

	return scaled;
};

const toUnsettleableResult = (
	members: ISettlementMemberInput[],
): ISettlementResult => {
	const balances: ISettledBalance[] = members.map((member) => {
		const mealBalance = round2(member.mealBalance);

		return {
			memberId: member.memberId,
			mealBalance,
			balanceStatus:
				mealBalance > 0 ? "RECEIVER" : mealBalance < 0 ? "GIVER" : "SETTLED",
		};
	});

	const totalPositiveBalance = balances.reduce(
		(sum, balance) => sum + Math.max(balance.mealBalance, 0),
		0,
	);

	return {
		transfers: [],
		balances,
		canSettle: false,
		totalPositiveBalance: round2(totalPositiveBalance),
	};
};

/**
 * Formula 6: greedy settlement matching.
 *
 * Balances are normalized to paise first, so every transfer is exactly two
 * decimals and the sum of transfers always equals the total positive balance.
 * Givers are matched largest debt first; receivers largest credit first. Input
 * order is the deterministic tie-break.
 */
export const calculateSettlement = (
	members: ISettlementMemberInput[],
): ISettlementResult => {
	if (members.length === 0) {
		return {
			transfers: [],
			balances: [],
			canSettle: true,
			totalPositiveBalance: 0,
		};
	}

	const rawTotal = members.reduce((sum, member) => sum + member.mealBalance, 0);

	if (Math.abs(rawTotal) > BALANCE_TOLERANCE) {
		return toUnsettleableResult(members);
	}

	const normalized = normalizeToCents(members);

	if (!normalized) {
		return toUnsettleableResult(members);
	}

	// Snapshot the opening ledger before the greedy loop mutates the working
	// cents. The response must show the balances before any transfers.
	const balances: ISettledBalance[] = normalized.map((balance) => ({
		memberId: balance.memberId,
		mealBalance: balance.cents / 100,
		balanceStatus: balanceStatus(balance.cents),
	}));

	const totalPositiveBalance = normalized.reduce(
		(sum, balance) => sum + Math.max(balance.cents, 0),
		0,
	);

	const givers = normalized
		.filter((balance) => balance.cents < 0)
		.sort((a, b) => a.cents - b.cents || a.index - b.index);
	const receivers = normalized
		.filter((balance) => balance.cents > 0)
		.sort((a, b) => b.cents - a.cents || a.index - b.index);

	const transfers: ISettlementTransfer[] = [];
	let giverIndex = 0;
	let receiverIndex = 0;

	while (giverIndex < givers.length && receiverIndex < receivers.length) {
		const giver = givers[giverIndex];
		const receiver = receivers[receiverIndex];
		const amountCents = Math.min(-giver.cents, receiver.cents);

		if (amountCents > 0) {
			transfers.push({
				fromMemberId: giver.memberId,
				toMemberId: receiver.memberId,
				amount: amountCents / 100,
			});

			giver.cents += amountCents;
			receiver.cents -= amountCents;
		}

		if (giver.cents === 0) {
			giverIndex += 1;
		}

		if (receiver.cents === 0) {
			receiverIndex += 1;
		}
	}

	return {
		transfers,
		balances,
		canSettle: true,
		totalPositiveBalance: totalPositiveBalance / 100,
	};
};
