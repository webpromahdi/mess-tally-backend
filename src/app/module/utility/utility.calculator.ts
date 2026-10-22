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
