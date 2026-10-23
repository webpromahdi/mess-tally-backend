import httpStatus from "http-status";
import { MemberStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { IRequestUser } from "../auth/auth.interface";
import { requireActiveMembership } from "../mess/mess.scope";
import { currentMonthRange, parseMonthParam } from "../messMonth/month.util";
import { summaryService } from "../summary/summary.service";
import { utilityService } from "../utility/utility.service";
import type {
	IDashboardMemberMeal,
	IDashboardResult,
} from "./dashboard.interface";
import type { TDashboardQuery } from "./dashboard.validation";

/**
 * One read-only payload for the Dashboard quick view.
 *
 * The meal block comes from the Summary service, so the Dashboard can never
 * drift from the detailed Summary page or the AI tools. The utility block uses
 * the same Utility Fund service as the Utility page. Both are resolved for the
 * same normalized month.
 *
 * Utility data stays isolated: it is returned under its own key and never
 * enters the meal balance or settlement math.
 */
const getDashboard = async (
	user: IRequestUser,
	query: TDashboardQuery,
): Promise<IDashboardResult> => {
	const actor = await requireActiveMembership(user.userId);
	const month = parseMonthParam(query.month ?? currentMonthRange().name).name;

	const [summary, utilityFund, pendingMemberCount] = await Promise.all([
		summaryService.getSummary(user, month),
		utilityService.getUtilityFund(user, { month }),
		actor.isManager
			? prisma.messMember.count({
					where: { messId: actor.messId, status: MemberStatus.PENDING },
				})
			: Promise.resolve(null),
	]);

	const me = summary.members.find((member) => member.memberId === actor.id);

	if (!me) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			"Your membership is missing from the monthly summary.",
		);
	}

	const myMeal: IDashboardMemberMeal = {
		memberId: me.memberId,
		totalMeals: me.totalMeals,
		mealCost: me.mealCost,
		bazarPaid: me.bazarPaid,
		mealBalance: me.mealBalance,
		balanceStatus: me.balanceStatus,
	};

	return {
		month: summary.month,
		meal: {
			totalMeals: summary.totals.totalMeals,
			totalBazar: summary.totals.totalBazar,
			mealRate: summary.totals.mealRate,
			me: myMeal,
		},
		utility: {
			totalDeposits: utilityFund.totalDeposits,
			totalPaidBills: utilityFund.totalPaidBills,
			balance: utilityFund.balance,
			needsReplenishment: utilityFund.needsReplenishment,
		},
		pendingMemberCount,
	};
};

export const dashboardService = {
	getDashboard,
};
