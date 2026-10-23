import httpStatus from "http-status";
import config from "../config";
import { AppError } from "../utils/AppError";
import { redisClient } from "./redis";

const BKASH_TIMEOUT_MS = 15_000;

export type TBkashResult = Record<string, any>;

const readJson = async (response: Response): Promise<TBkashResult> => {
	try {
		return (await response.json()) as TBkashResult;
	} catch {
		return {};
	}
};

/**
 * One POST to a bKash Tokenized Checkout endpoint with a live ID token.
 * Network failures and gateway errors surface as a clean 502 instead of a raw
 * fetch exception, and the fetch itself can never hang past 15 seconds.
 */
const bkashRequest = async (
	path: string,
	body: TBkashResult,
): Promise<TBkashResult> => {
	const idToken = await getBkashIdToken();
	if (!idToken) {
		throw new AppError(httpStatus.BAD_GATEWAY, "bKash authentication is unavailable");
	}

	const response = await fetch(`${config.bkash_base_url}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			Authorization: idToken,
			"X-App-Key": config.bkash_app_key,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(BKASH_TIMEOUT_MS),
	});

	const result = await readJson(response);

	if (!response.ok) {
		throw new AppError(
			httpStatus.BAD_GATEWAY,
			`Failed to call bKash (${path}): ${
				result.message || result.errorMessage || response.statusText
			}`,
		);
	}

	return result;
};

export interface ICreateBkashPaymentInput {
	amount: string;
	merchantInvoiceNumber: string;
	payerReference: string;
	callbackURL: string;
}

export const createBkashPayment = async (
	input: ICreateBkashPaymentInput,
): Promise<TBkashResult> => {
	const body: TBkashResult = {
		mode: "0011",
		payerReference: input.payerReference,
		callbackURL: input.callbackURL,
		amount: input.amount,
		currency: "BDT",
		intent: "sale",
		merchantInvoiceNumber: input.merchantInvoiceNumber,
	};

	if (config.bkash_merchant_association_info) {
		body.merchantAssociationInfo = config.bkash_merchant_association_info;
	}

	return bkashRequest("/tokenized/checkout/create", body);
};

export const executeBkashPayment = async (
	paymentID: string,
): Promise<TBkashResult> =>
	bkashRequest("/tokenized/checkout/execute", { paymentID });

export const queryBkashPayment = async (
	paymentID: string,
): Promise<TBkashResult> =>
	bkashRequest("/tokenized/checkout/payment/status", { paymentID });

export const getBkashIdToken = async () => {
	try {
		const idToken = "bkash:idToken";
		const refreshToken = "bkash:refreshToken";

		let bkashIdToken = await redisClient.get(idToken);
		const bkashIdTokenTTL = await redisClient.ttl(idToken);
		const bkashRefreshToken = await redisClient.get(refreshToken);
		const bkashRefreshTokenTTL = await redisClient.ttl(refreshToken);

		if (
			(bkashIdTokenTTL <= 600 || !bkashIdToken) &&
			bkashRefreshToken &&
			bkashRefreshTokenTTL > 600
		) {
			const bkashRefreshTokenResponse = await fetch(
				`${config.bkash_base_url}/tokenized/checkout/token/refresh`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
						username: config.bkash_username,
						password: config.bkash_password,
					},
					body: JSON.stringify({
						app_key: config.bkash_app_key,
						app_secret: config.bkash_app_secret,
						refresh_token: bkashRefreshToken,
					}),
				},
			);

			if (!bkashRefreshTokenResponse.ok) {
				throw new AppError(
					httpStatus.UNAUTHORIZED,
					"Bkash refresh token is invalid",
				);
			}

			const bkashRefreshTokenResult = await bkashRefreshTokenResponse.json();

			bkashIdToken = bkashRefreshTokenResult.id_token as string;

			await redisClient.set(idToken, bkashIdToken, {
				expiration: {
					type: "EX",
					value: 3600, // 1 hour in seconds
				},
			});

			return bkashIdToken;
		}

		if (bkashIdTokenTTL > 600) {
			return bkashIdToken;
		}

		const response = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/token/grant`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					username: config.bkash_username,
					password: config.bkash_password,
				},
				body: JSON.stringify({
					app_key: config.bkash_app_key,
					app_secret: config.bkash_app_secret,
				}),
			},
		);

		if (!response.ok) {
			throw new AppError(
				httpStatus.BAD_GATEWAY,
				`Failed to get bKash ID token: ${response.statusText}`,
			);
		}

		const result = await response.json();

		await redisClient.set(idToken, result.id_token, {
			expiration: {
				type: "EX",
				value: 3600, // 1 hour in seconds
			},
		});

		await redisClient.set(refreshToken, result.refresh_token, {
			expiration: {
				type: "EX",
				value: 3600 * 24 * 28, // 28 days
			},
		});

		bkashIdToken = result.id_token;

		return bkashIdToken;
	} catch (error: any) {
		if (error instanceof AppError) throw error;
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			`Failed to get bKash ID token: ${error.message}`,
		);
	}
};