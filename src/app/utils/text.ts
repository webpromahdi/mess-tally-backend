/**
 * Optional text normalisation for PATCH-friendly fields.
 *
 * - `undefined` means "field not supplied", so the service leaves it alone.
 * - An empty/whitespace string is stored as `null` (clears the field).
 */
export const normalizeOptionalText = (
	value: string | null | undefined,
): string | null | undefined => {
	if (value === undefined) {
		return undefined;
	}

	const trimmed = value?.trim();

	return trimmed ? trimmed : null;
};
