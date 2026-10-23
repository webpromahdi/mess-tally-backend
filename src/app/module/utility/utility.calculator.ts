import { round2 } from "../messMonth/month.util";

/**
 * Formula U1: per-person utility share.
 *
 * Only ACTIVE members are counted by the caller. A mess with no active members
 * yields 0 instead of a division-by-zero error (AC 5.1.2, AC 5.1.3).
 *
 * Phase 3 extends this file with the fund balance (U2) and replenishment
 * estimate (U3); keeping the share pure means the Dashboard and AI tools reuse
 * the same numbers.
 */
export const calculateUtilityShare = (
	totalUtilityBills: number,
	activeMemberCount: number,
): number => {
	if (activeMemberCount <= 0) {
		return 0;
	}

	return round2(totalUtilityBills / activeMemberCount);
};

/**
 * Formula U2: utility fund balance.
 *
 * Deposits are money collected for the month; only paid bills are deducted.
 * Unpaid bills stay outside the fund balance until they are marked paid.
 * A negative balance is valid (the fund has spent more than it collected).
 */
export const calculateUtilityFundBalance = (
	totalDeposits: number,
	totalPaidBills: number,
): number => round2(totalDeposits - totalPaidBills);

/**
 * Formula U3: replenishment estimate.
 *
 * The manager picks the per-member amount for the next collection round. No
 * default is stored in the schema, so the amount is always supplied by the
 * caller. A mess with no ACTIVE members expects 0.
 */
export const calculateReplenishmentEstimate = (
	perMember: number,
	activeMemberCount: number,
): number => {
	if (activeMemberCount <= 0) {
		return 0;
	}

	return round2(perMember * activeMemberCount);
};
