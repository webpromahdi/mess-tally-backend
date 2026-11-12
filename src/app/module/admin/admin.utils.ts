/** Pure helpers for the admin module (no Prisma, no I/O). */

export interface IRevenuePoint {
	/** "YYYY-MM" (UTC). */
	month: string;
	amount: number;
	count: number;
}

const monthKey = (date: Date): string =>
	`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Buckets payments into one point per calendar month (UTC) from `from` to `to`
 * inclusive. Months without payments are kept with 0 so a chart has no gaps.
 */
export const bucketRevenueByMonth = (
	payments: { amount: number; paidAt: Date }[],
	from: Date,
	to: Date,
): IRevenuePoint[] => {
	const points = new Map<string, IRevenuePoint>();
	const cursor = new Date(
		Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1),
	);
	const last = monthKey(to);

	// Bounded by the range check in the service (from <= to).
	while (monthKey(cursor) <= last) {
		const key = monthKey(cursor);
		points.set(key, { month: key, amount: 0, count: 0 });
		cursor.setUTCMonth(cursor.getUTCMonth() + 1);
	}

	for (const payment of payments) {
		const point = points.get(monthKey(payment.paidAt));
		if (!point) continue;
		point.amount = round2(point.amount + payment.amount);
		point.count += 1;
	}

	return [...points.values()];
};

/** `{page, limit, total}` -> response `meta` and Prisma `skip`. */
export const pageMeta = (page: number, limit: number, total: number) => ({
	page,
	limit,
	total,
	totalPages: Math.max(1, Math.ceil(total / limit)),
});
