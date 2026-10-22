import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1970;
const MAX_YEAR = 2999;
const MS_PER_DAY = 86_400_000;

/**
 * A calendar month in UTC. `startDate` is the first day at 00:00 UTC and
 * `endDate` is the last day at 00:00 UTC. `nextMonthStart` is exclusive and is
 * what every range query should use (`gte startDate, lt nextMonthStart`).
 */
export interface IMonthRange {
	name: string;
	startDate: Date;
	endDate: Date;
	nextMonthStart: Date;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

const invalidMonthError = () =>
	new AppError(
		httpStatus.BAD_REQUEST,
		"Month must be in YYYY-MM format (for example 2026-10).",
	);

const invalidDateError = () =>
	new AppError(
		httpStatus.BAD_REQUEST,
		"Date must be a valid calendar date in YYYY-MM-DD format.",
	);

const assertYear = (year: number) => {
	if (year < MIN_YEAR || year > MAX_YEAR) {
		throw invalidMonthError();
	}
};

/**
 * Builds the range for a zero-based month index (`0` = January). Kept pure so
 * the unit tests and every caller use exactly the same UTC boundaries.
 */
export const monthRangeFromParts = (
	year: number,
	monthIndex: number,
): IMonthRange => {
	assertYear(year);

	if (monthIndex < 0 || monthIndex > 11) {
		throw invalidMonthError();
	}

	const startDate = new Date(Date.UTC(year, monthIndex, 1));
	const endDate = new Date(Date.UTC(year, monthIndex + 1, 0));
	const nextMonthStart = new Date(Date.UTC(year, monthIndex + 1, 1));

	return {
		name: `${year}-${pad2(monthIndex + 1)}`,
		startDate,
		endDate,
		nextMonthStart,
	};
};

/**
 * Parses the public `YYYY-MM` parameter. The strict shape check happens first
 * so `2026-1`, `2026-13` and `not-a-month` all produce the same 400.
 */
export const parseMonthParam = (value: string): IMonthRange => {
	const match = MONTH_PATTERN.exec(value.trim());

	if (!match) {
		throw invalidMonthError();
	}

	const year = Number(match[1]);
	const month = Number(match[2]);

	if (month < 1 || month > 12) {
		throw invalidMonthError();
	}

	return monthRangeFromParts(year, month - 1);
};

/**
 * Derives the calendar month that contains `date`. Callers pass date-only
 * values (UTC midnight), so this never shifts across a local timezone.
 */
export const monthRangeFromDate = (date: Date): IMonthRange => {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
		throw invalidDateError();
	}

	return monthRangeFromParts(date.getUTCFullYear(), date.getUTCMonth());
};

/** Parses a date-only string into a UTC-midnight `Date`, rejecting 2026-02-30. */
export const parseDateOnly = (value: string): Date => {
	const match = DATE_PATTERN.exec(value.trim());

	if (!match) {
		throw invalidDateError();
	}

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);

	if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) {
		throw invalidDateError();
	}

	const date = new Date(Date.UTC(year, month - 1, day));

	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		throw invalidDateError();
	}

	return date;
};

/** Formats a UTC date as `YYYY-MM-DD`. This is the only date wire format. */
export const formatDateOnly = (date: Date): string =>
	`${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
		date.getUTCDate(),
	)}`;

export const currentMonthRange = (): IMonthRange =>
	monthRangeFromDate(new Date());

export const isSameMonth = (a: Date, b: Date): boolean =>
	a.getUTCFullYear() === b.getUTCFullYear() &&
	a.getUTCMonth() === b.getUTCMonth();

/** Every `YYYY-MM-DD` in the month, in order. Used to build the meal grid. */
export const listMonthDays = (range: IMonthRange): string[] => {
	const days: string[] = [];

	for (
		let cursor = range.startDate.getTime();
		cursor < range.nextMonthStart.getTime();
		cursor += MS_PER_DAY
	) {
		days.push(formatDateOnly(new Date(cursor)));
	}

	return days;
};

/**
 * Presentation rounding only. Calculations (Phase 3) keep full precision.
 */
export const round2 = (value: number): number =>
	Math.round((value + Number.EPSILON) * 100) / 100;
