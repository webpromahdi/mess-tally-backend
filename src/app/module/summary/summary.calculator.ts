import type {
	IMemberCalculation,
	IMemberLedgerInput,
	ISummaryCalculation,
} from "./summary.interface";

/**
 * Formula 3: Meal Rate.
 *
 * Full precision is intentional. Callers round only when building the response
 * (AC 6.1.1). A month with no meals yields 0 instead of Infinity/NaN.
 */
export const calculateMealRate = (
	totalBazar: number,
	totalMeals: number,
): number => {
	if (totalMeals <= 0) {
		return 0;
	}

	return totalBazar / totalMeals;
};

/**
 * Formulas 1-5 for the whole house.
 *
 * This is pure: the service supplies one row per included member, and the
 * result contains no database shapes. Guest meals are already part of each
 * member's `totalMeals`. Utility data never enters this function (AC 6.1.5).
 */
export const calculateSummary = (
	members: IMemberLedgerInput[],
): ISummaryCalculation => {
	let totalMeals = 0;
	let totalBazar = 0;

	for (const member of members) {
		totalMeals += member.totalMeals;
		totalBazar += member.bazarPaid;
	}

	const mealRate = calculateMealRate(totalBazar, totalMeals);
	const calculations: IMemberCalculation[] = members.map((member) => {
		const mealCost = member.totalMeals * mealRate;

		return {
			memberId: member.memberId,
			totalMeals: member.totalMeals,
			mealCost,
			bazarPaid: member.bazarPaid,
			mealBalance: member.bazarPaid - mealCost,
		};
	});

	return {
		totalMeals,
		totalBazar,
		mealRate,
		members: calculations,
	};
};

/**
 * How many more days a member's meal balance covers at their average daily
 * meal cost so far this month. 0 when the balance is used up (they owe), null
 * when there is no usage yet to average.
 */
export const estimateDaysLeft = (
	mealBalance: number,
	totalMeals: number,
	daysElapsed: number,
	mealRate: number,
): number | null => {
	if (mealBalance <= 0) {
		return 0;
	}

	const dailyCost = daysElapsed > 0 ? (totalMeals / daysElapsed) * mealRate : 0;

	return dailyCost > 0 ? Math.floor(mealBalance / dailyCost) : null;
};
