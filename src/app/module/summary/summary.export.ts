import type { ISummaryResult } from "./summary.interface";

type TCsvValue = string | number | boolean | null;

const formatNumber = (value: number): string => value.toFixed(2);

const escapeCell = (value: TCsvValue): string => {
	if (value === null) {
		return "";
	}

	let text = String(value);

	// Spreadsheet applications may evaluate a text cell that begins with one
	// of these characters. Prefixing an apostrophe keeps names/titles literal.
	if (typeof value === "string" && /^[=+\-@]/.test(text)) {
		text = `'${text}`;
	}

	if (/[",\r\n]/.test(text)) {
		return `"${text.replace(/"/g, '""')}"`;
	}

	return text;
};

/**
 * Builds the member table, summary totals, and settlement list from the exact
 * Summary response. Utility values are intentionally absent (AC 6.1.5).
 */
export const buildSummaryCsv = (summary: ISummaryResult): string => {
	const memberNames = new Map(
		summary.members.map((member) => [member.memberId, member.name]),
	);
	const rows: TCsvValue[][] = [
		["Month", summary.month.name],
		["Status", summary.month.status ?? "MISSING"],
		["Locked", summary.isLocked],
		["Can Settle", summary.canSettle],
		["Total Meals", formatNumber(summary.totals.totalMeals)],
		["Total Bazar", formatNumber(summary.totals.totalBazar)],
		["Meal Rate", formatNumber(summary.totals.mealRate)],
		[
			"Total Positive Balance",
			formatNumber(summary.totals.totalPositiveBalance),
		],
		[],
		[
			"Member ID",
			"Name",
			"Status",
			"Total Meals",
			"Meal Cost",
			"Bazar Paid",
			"Meal Balance",
			"Balance Status",
		],
	];

	for (const member of summary.members) {
		rows.push([
			member.memberId,
			member.name,
			member.status,
			formatNumber(member.totalMeals),
			formatNumber(member.mealCost),
			formatNumber(member.bazarPaid),
			formatNumber(member.mealBalance),
			member.balanceStatus,
		]);
	}

	rows.push(
		[],
		["Settlement"],
		["From Member ID", "From Name", "To Member ID", "To Name", "Amount"],
	);

	for (const transfer of summary.settlement) {
		rows.push([
			transfer.fromMemberId,
			memberNames.get(transfer.fromMemberId) ?? "",
			transfer.toMemberId,
			memberNames.get(transfer.toMemberId) ?? "",
			formatNumber(transfer.amount),
		]);
	}

	return `${rows.map((row) => row.map(escapeCell).join(",")).join("\r\n")}\r\n`;
};
