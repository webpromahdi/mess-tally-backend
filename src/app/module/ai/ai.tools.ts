import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { MemberStatus } from "../../../generated/prisma/enums";
import config from "../../config";
import { moneyAmountSchema } from "../../utils/money";
import { currentMonthName, todayDateOnly } from "../../utils/time";
import type { IRequestUser } from "../auth/auth.interface";
import { bazarService } from "../bazar/bazar.service";
import { dashboardService } from "../dashboard/dashboard.service";
import { depositService } from "../deposit/deposit.service";
import { mealService } from "../meal/meal.service";
import { memberService } from "../messMember/member.service";
import { monthService } from "../messMonth/month.service";
import { subscriptionService } from "../subscription/subscription.service";
import { estimateDaysLeft } from "../summary/summary.calculator";
import { summaryService } from "../summary/summary.service";
import { utilityService } from "../utility/utility.service";

export interface IAiTool {
	definition: ChatCompletionFunctionTool;
	execute: (user: IRequestUser, rawArgs: unknown) => Promise<unknown>;
}

/**
 * Every tool wraps an existing read service and passes the logged-in user, so
 * mess scoping and permissions are the same as the REST endpoints. The model
 * only chooses arguments like `month`; it never supplies a mess or user id.
 * Results are trimmed to the fields an answer needs to save tokens.
 */
const tool = <S extends z.ZodObject>(
	name: string,
	description: string,
	schema: S,
	run: (user: IRequestUser, args: z.infer<S>) => Promise<unknown>,
): IAiTool => {
	const { $schema: _ignored, ...parameters } = z.toJSONSchema(schema, {
		io: "input",
	});

	return {
		definition: {
			type: "function",
			function: { name, description, parameters },
		},
		execute: async (user, rawArgs) => {
			// Model output is untrusted input.
			const args = schema.safeParse(rawArgs);

			return args.success
				? run(user, args.data)
				: { error: args.error.issues[0].message };
		},
	};
};

// Models send `null` for "not given", and Groq rejects args that don't match
// the schema, so optional args accept null and turn it into undefined.
const optional = <T extends z.ZodType>(schema: T) =>
	schema.nullish().transform((value) => value ?? undefined);

const monthArg = z.object({
	month: optional(z.string().regex(/^\d{4}-\d{2}$/)).describe(
		"YYYY-MM; null for the current month",
	),
});

export const aiTools: IAiTool[] = [
	tool(
		"get_my_summary",
		"The user's own meals, meal cost, bazar paid and meal balance, plus mess meal rate and utility fund.",
		monthArg,
		async (user, { month }) => {
			const result = await dashboardService.getDashboard(user, { month });
			const { memberId: _id, ...me } = result.meal.me;

			return {
				month: result.month.name,
				monthStatus: result.month.status,
				meal: { ...result.meal, me },
				utilityFund: result.utility,
				pendingMemberCount: result.pendingMemberCount,
			};
		},
	),
	tool(
		"get_mess_summary",
		"Whole mess for a month: meal rate, totals, every member's meals/cost/bazar/balance and who should pay whom.",
		monthArg,
		async (user, { month }) => {
			const result = await summaryService.getSummary(user, month);
			const names = new Map(result.members.map((m) => [m.memberId, m.name]));

			return {
				month: result.month.name,
				isLocked: result.isLocked,
				totals: result.totals,
				members: result.members.map(
					({ memberId: _id, avatarUrl: _avatar, ...member }) => member,
				),
				settlement: result.settlement.map((t) => ({
					from: names.get(t.fromMemberId),
					to: names.get(t.toMemberId),
					amount: t.amount,
				})),
			};
		},
	),
	tool(
		"get_meals",
		"Meal counts per member for a month. Set detail=true only when daily breakdown is needed.",
		monthArg.extend({ detail: optional(z.boolean()) }),
		async (user, { month, detail }) => {
			const result = await mealService.getMealGrid(user, month);

			return {
				month: result.month.name,
				houseTotals: result.houseTotals,
				members: result.members.map((m) => ({
					name: m.name,
					totals: m.totals,
					...(detail && {
						days: m.days
							.filter((d) => d.total > 0)
							.map(({ date, breakfast, lunch, dinner, guestMeals }) => ({
								date,
								breakfast,
								lunch,
								dinner,
								guestMeals,
							})),
					}),
				})),
			};
		},
	),
	tool(
		"get_bazar",
		"Bazar (grocery) purchases for a month: each entry and totals per shopper.",
		monthArg,
		async (user, { month }) => {
			const result = await bazarService.listBazar(user, { month });

			return {
				month: result.month.name,
				houseTotal: result.totals.houseTotal,
				byShopper: result.totals.byShopper.map(({ memberId: _id, ...s }) => s),
				entries: result.entries.map((e) => ({
					date: e.bazarDate,
					title: e.title,
					items: e.items,
					amount: e.amount,
					shopper: e.shopperName,
				})),
			};
		},
	),
	tool(
		"get_utility_deposits",
		"Money members deposited into the utility fund for a month.",
		monthArg,
		async (user, { month }) => {
			const result = await depositService.listDeposits(user, { month });

			return {
				month: result.month.name,
				total: result.total,
				byMember: result.byMember.map(({ memberId: _id, ...m }) => m),
				deposits: result.deposits.map((d) => ({
					member: d.memberName,
					amount: d.amount,
					date: d.date,
					note: d.note,
				})),
			};
		},
	),
	tool(
		"get_utilities",
		"Utility bills (rent, electricity, gas, internet...) for a month, per-person share, and utility fund balance.",
		monthArg,
		async (user, { month }) => {
			const [list, fund] = await Promise.all([
				utilityService.listUtilities(user, { month }),
				utilityService.getUtilityFund(user, { month }),
			]);

			return {
				month: list.month.name,
				totals: list.totals,
				fund: {
					totalDeposits: fund.totalDeposits,
					totalPaidBills: fund.totalPaidBills,
					balance: fund.balance,
					needsReplenishment: fund.needsReplenishment,
				},
				bills: list.bills.map((b) => ({
					category: b.category,
					title: b.title,
					amount: b.amount,
					dueDate: b.dueDate,
					isPaid: b.isPaid,
					paidBy: b.paidByName,
				})),
			};
		},
	),
	tool(
		"get_replenishment_estimate",
		"Manager only: total the utility fund collects if every active member deposits perMember.",
		z.object({ perMember: moneyAmountSchema }),
		(user, args) => utilityService.getReplenishmentEstimate(user, args),
	),
	tool(
		"get_members",
		"Members of the mess with role, status and manager flag. Filter by status if needed.",
		z.object({ status: optional(z.enum(MemberStatus)) }),
		async (user, args) => {
			const result = await memberService.listMembers(user, args);

			return result.members.map((m) => ({
				name: m.name,
				role: m.role,
				status: m.status,
				isManager: m.isManager,
				joinedAt: m.joinedAt,
				leftAt: m.leftAt,
			}));
		},
	),
	tool(
		"get_months",
		"All months of the mess with OPEN/CLOSED status.",
		z.object({}),
		async (user) => {
			const result = await monthService.listMonths(user);

			return result.months.map((m) => ({
				name: m.name,
				status: m.status,
				isCurrent: m.isCurrent,
				closedAt: m.closedAt,
			}));
		},
	),
	tool(
		"get_subscription",
		"Mess plan (FREE/PRO), expiry, PRO features, prices and recent payments.",
		z.object({}),
		async (user) => {
			const [plan, payments] = await Promise.all([
				subscriptionService.getSubscription(user),
				subscriptionService.listPayments(user),
			]);

			return {
				...plan,
				recentPayments: payments
					.slice(0, 5)
					.map(({ id: _id, bkashTrxId: _trx, ...p }) => p),
			};
		},
	),
	tool(
		"estimate_days_left",
		"How many more days the user's current meal balance lasts at their average daily meal cost this month.",
		z.object({}),
		async (user) => {
			const month = currentMonthName(config.app_timezone);
			const daysElapsed = Number(todayDateOnly(config.app_timezone).slice(8));
			const { meal } = await dashboardService.getDashboard(user, { month });

			return {
				month,
				daysElapsed,
				mealBalance: meal.me.mealBalance,
				mealRate: meal.mealRate,
				daysLeft: estimateDaysLeft(
					meal.me.mealBalance,
					meal.me.totalMeals,
					daysElapsed,
					meal.mealRate,
				),
			};
		},
	),
];
