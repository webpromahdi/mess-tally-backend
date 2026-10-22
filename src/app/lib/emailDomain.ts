import { resolve4, resolveMx } from "node:dns/promises";

type DomainCheckResult =
	| { ok: true; transient?: boolean }
	| { ok: false; message: string; transient?: boolean };

const CACHE_TTL_MS = 10 * 60 * 1000;
const TRANSIENT_CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const DNS_TIMEOUT_MS = 3000;

const cache = new Map<
	string,
	{ result: DomainCheckResult; expiresAt: number }
>();

const NO_MAIL_MESSAGE =
	"This email domain cannot receive emails. Please check for a typo, e.g. name@gmail.com";
const DOMAIN_NOT_FOUND_MESSAGE =
	"This email domain does not exist. Please check for a typo, e.g. name@gmail.com";

const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
	Promise.race([
		promise,
		new Promise<T>((_, reject) => {
			const timer = setTimeout(() => {
				const error = new Error("DNS lookup timed out");
				Object.assign(error, { code: "ETIMEOUT" });
				reject(error);
			}, DNS_TIMEOUT_MS);
			timer.unref();
		}),
	]);

const hasAddressRecord = async (domain: string) => {
	try {
		const addresses = await withTimeout(resolve4(domain));
		return addresses.length > 0;
	} catch {
		return false;
	}
};

const performCheck = async (domain: string): Promise<DomainCheckResult> => {
	try {
		const records = await withTimeout(resolveMx(domain));

		// RFC 7505 null MX: the domain explicitly refuses all email
		const hasNullMx = records.some(
			(record) => record.exchange === "" && record.priority === 0,
		);
		if (hasNullMx) return { ok: false, message: NO_MAIL_MESSAGE };

		if (records.length > 0) return { ok: true };

		// No MX records: RFC 5321 falls back to the domain's A/AAAA record
		return (await hasAddressRecord(domain))
			? { ok: true }
			: { ok: false, message: NO_MAIL_MESSAGE };
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;

		if (code === "ENOTFOUND") {
			return { ok: false, message: DOMAIN_NOT_FOUND_MESSAGE };
		}

		if (code === "ENODATA") {
			return (await hasAddressRecord(domain))
				? { ok: true }
				: { ok: false, message: NO_MAIL_MESSAGE };
		}

		// Fail open on transient DNS problems (timeouts, SERVFAIL, network down)
		// so a resolver outage never blocks new registrations.
		return { ok: true, transient: true };
	}
};

export const checkEmailDomain = async (
	domain: string,
): Promise<DomainCheckResult> => {
	const normalizedDomain = domain.toLowerCase();
	const now = Date.now();
	const cached = cache.get(normalizedDomain);

	if (cached && cached.expiresAt > now) return cached.result;

	const result = await performCheck(normalizedDomain);

	if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();

	const ttl = result.transient ? TRANSIENT_CACHE_TTL_MS : CACHE_TTL_MS;
	cache.set(normalizedDomain, { result, expiresAt: now + ttl });

	return result;
};
