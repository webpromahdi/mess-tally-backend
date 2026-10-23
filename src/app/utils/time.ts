/**
 * Timezone-aware date helpers.
 *
 * All `mess_month` rows and date-only values are stored and compared in UTC,
 * but human-day rules (today's meals, the cutoff time and the "current
 * month" archive gate) must follow the app timezone. These helpers keep a
 * single source of truth for that timezone.
 */

type TWallClock = {
	year: string;
	month: string;
	day: string;
	hour: string;
	minute: string;
};

const wallClockFormatter = (timeZone: string) =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});

const wallClock = (date: Date, timeZone: string): TWallClock => {
	const parts = wallClockFormatter(timeZone).formatToParts(date);
	const byType = new Map(
		parts.map((part) => [part.type, part.value] as const),
	);

	return {
		year: byType.get("year")!,
		month: byType.get("month")!,
		day: byType.get("day")!,
		hour: byType.get("hour")!,
		minute: byType.get("minute")!,
	};
};

/** `YYYY-MM-DD` for the given date in the given timezone. */
export const dateOnlyInTimeZone = (date: Date, timeZone: string): string => {
	const clock = wallClock(date, timeZone);

	return `${clock.year}-${clock.month}-${clock.day}`;
};

/** `YYYY-MM` for the given date in the given timezone. */
export const monthNameInTimeZone = (date: Date, timeZone: string): string => {
	const clock = wallClock(date, timeZone);

	return `${clock.year}-${clock.month}`;
};

/** `YYYY-MM-DD` for "now" in the given timezone. */
export const todayDateOnly = (timeZone: string, now = new Date()): string =>
	dateOnlyInTimeZone(now, timeZone);

/** `YYYY-MM` for "now" in the given timezone. */
export const currentMonthName = (timeZone: string, now = new Date()): string =>
	monthNameInTimeZone(now, timeZone);

/** `HH:mm` for the given date in the given timezone. */
export const timeInTimeZone = (date: Date, timeZone: string): string => {
	const clock = wallClock(date, timeZone);

	return `${clock.hour}:${clock.minute}`;
};

/**
 * True when the day's cutoff time has already passed in the app timezone.
 * A missing cutoff never blocks; an invalid cutoff forms also never blocks,
 * so a bad value cannot lock every meal write.
 */
export const isPastCutoff = (
	cutoffTime: string | null,
	timeZone: string,
	now = new Date(),
): boolean => {
	if (!cutoffTime) {
		return false;
	}

	const [hour, minute] = cutoffTime.split(":").map(Number);

	if (
		!Number.isInteger(hour) ||
		!Number.isInteger(minute) ||
		hour < 0 ||
		hour > 23 ||
		minute < 0
	) {
		return false;
	}

	const nowClock = wallClock(now, timeZone);
	const cutoffMinutes = hour * 60 + minute;
	const nowMinutes =
		Number(nowClock.hour) * 60 + Number(nowClock.minute);

	return nowMinutes >= cutoffMinutes;
};

/** Adds whole days to a UTC timestamp without DST surprises. */
export const addDays = (date: Date, days: number): Date =>
	new Date(date.getTime() + days * 86_400_000);
