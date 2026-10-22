import bcrypt from "bcryptjs";
import config from "../../config";
import type {
	IForgotPasswordPayload,
	ILoginUser,
	IRegisterUser,
	IRequestUser,
	IResendOtpPayload,
	IResetPasswordPayload,
	IVerifyEmailPayload,
} from "./auth.interface";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import httpStatus from "http-status";
import { Role, Status } from "../../../generated/prisma/enums";
import { createAuthTokens } from "../../utils/authToken";
import { jwtUtils } from "../../utils/jwt";
import type { JwtPayload } from "jsonwebtoken";
import { redisClient } from "../../lib/redis";
import crypto from "crypto";
import path from "path";
import ejs from "ejs";
import { transporter } from "../../lib/nodemailer";

const activeMessSelect = {
	id: true,
	name: true,
	roomCode: true,
	currency: true,
	isJoinable: true,
	requireApproval: true,
	mealCutoffTime: true,
};

/**
 * Active mess is resolved from `user.activeMessId`, not from the JWT.
 * Returns null when the user has no active mess.
 */
const getActiveMess = async (activeMessId: string | null) => {
	if (!activeMessId) {
		return null;
	}

	return prisma.mess.findUnique({
		where: { id: activeMessId },
		select: activeMessSelect,
	});
};

const OTP_EXPIRATION_SECONDS = 5 * 60;
const OTP_SESSION_EXPIRATION_SECONDS = 60 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_RESENDS_PER_SESSION = 3;
const MAX_OTP_ATTEMPTS = 5;

type TOtpPurpose = "REGISTRATION" | "FORGOT_PASSWORD";

const registrationOtpKey = (email: string) => `user-registration-otp:${email}`;
const registrationDataKey = (email: string) =>
	`user-registration-data:${email}`;
const forgotPasswordOtpKey = (email: string) =>
	`user-forgetPassword-otp:${email}`;
const forgotPasswordSessionKey = (email: string) =>
	`user-forgetPassword-session:${email}`;
const resendCooldownKey = (purpose: TOtpPurpose, email: string) =>
	`otp-resend-cooldown:${purpose}:${email}`;
const resendCountKey = (purpose: TOtpPurpose, email: string) =>
	`otp-resend-count:${purpose}:${email}`;
const otpAttemptKey = (purpose: TOtpPurpose, email: string) =>
	`otp-attempt-count:${purpose}:${email}`;

const generateOtp = (email: string) => {
	const otp = crypto.randomInt(100000, 1000000).toString();

	if (config.node_env === "development") {
		console.log(`[dev] OTP ${email} : ${otp}`);
	}

	return otp;
};

const storeOtp = async (key: string, otp: string) => {
	await redisClient.set(key, otp, {
		expiration: {
			type: "EX",
			value: OTP_EXPIRATION_SECONDS,
		},
	});
};

type TOtpEmailOptions = {
	template: string;
	subject: string;
	name: string;
	email: string;
	otp: string;
};

const sendOtpEmail = async ({
	template,
	subject,
	name,
	email,
	otp,
}: TOtpEmailOptions) => {
	const templatePath = path.join(process.cwd(), "src/app/template", template);

	const html = await ejs.renderFile(templatePath, {
		name,
		email,
		otp,
		expirationMinutes: OTP_EXPIRATION_SECONDS / 60,
	});

	await transporter.sendMail({
		from: config.email_sender,
		to: email,
		subject,
		html,
	});
};

const acquireResendCooldown = async (purpose: TOtpPurpose, email: string) => {
	const cooldownKey = resendCooldownKey(purpose, email);

	const acquired = await redisClient.set(cooldownKey, "1", {
		condition: "NX",
		expiration: {
			type: "EX",
			value: RESEND_COOLDOWN_SECONDS,
		},
	});

	if (acquired) return;

	const remainingSeconds = await redisClient.ttl(cooldownKey);

	throw new AppError(
		httpStatus.TOO_MANY_REQUESTS,
		`Please wait ${Math.max(remainingSeconds, 1)} second(s) before requesting another code`,
	);
};

const releaseResendCooldown = async (purpose: TOtpPurpose, email: string) => {
	await redisClient.del(resendCooldownKey(purpose, email));
};

const resetResendCount = async (purpose: TOtpPurpose, email: string) => {
	await redisClient.del(resendCountKey(purpose, email));
};

const reserveResendSlot = async (purpose: TOtpPurpose, email: string) => {
	const countKey = resendCountKey(purpose, email);

	const resendsUsed = Number((await redisClient.get(countKey)) ?? 0);

	if (resendsUsed >= MAX_RESENDS_PER_SESSION) {
		throw new AppError(
			httpStatus.TOO_MANY_REQUESTS,
			"Resend limit reached for this session. Please start the process again.",
		);
	}

	await acquireResendCooldown(purpose, email);

	const nextCount = await redisClient.incr(countKey);

	if (nextCount === 1) {
		await redisClient.expire(countKey, OTP_SESSION_EXPIRATION_SECONDS);
	}

	if (nextCount > MAX_RESENDS_PER_SESSION) {
		throw new AppError(
			httpStatus.TOO_MANY_REQUESTS,
			"Resend limit reached for this session. Please start the process again.",
		);
	}

	return nextCount;
};

const rollbackResendSlot = async (purpose: TOtpPurpose, email: string) => {
	await releaseResendCooldown(purpose, email);
	await redisClient.decr(resendCountKey(purpose, email));
};

const resetOtpAttempts = async (purpose: TOtpPurpose, email: string) => {
	await redisClient.del(otpAttemptKey(purpose, email));
};

const recordOtpAttempt = async (purpose: TOtpPurpose, email: string) => {
	const attemptKey = otpAttemptKey(purpose, email);

	const attempts = await redisClient.incr(attemptKey);

	if (attempts === 1) {
		await redisClient.expire(attemptKey, OTP_EXPIRATION_SECONDS);
	}

	return attempts;
};

const clearRegistrationSession = async (email: string) => {
	await redisClient.del([
		registrationOtpKey(email),
		registrationDataKey(email),
		resendCountKey("REGISTRATION", email),
		resendCooldownKey("REGISTRATION", email),
		otpAttemptKey("REGISTRATION", email),
	]);
};

const clearForgotPasswordSession = async (email: string) => {
	await redisClient.del([
		forgotPasswordOtpKey(email),
		forgotPasswordSessionKey(email),
		resendCountKey("FORGOT_PASSWORD", email),
		resendCooldownKey("FORGOT_PASSWORD", email),
		otpAttemptKey("FORGOT_PASSWORD", email),
	]);
};

const buildOtpIssueResult = (
	purpose: TOtpPurpose,
	email: string,
	resendsUsed: number,
) => {
	return {
		email,
		purpose,
		expiresInSeconds: OTP_EXPIRATION_SECONDS,
		resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS,
		resendsRemaining: Math.max(MAX_RESENDS_PER_SESSION - resendsUsed, 0),
	};
};

const registerUser = async (payload: IRegisterUser) => {
	const { name, password } = payload;

	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: {
			email,
		},
	});
	if (isUserExists) {
		throw new AppError(
			httpStatus.CONFLICT,
			"User with this email already exists",
		);
	}

	await acquireResendCooldown("REGISTRATION", email);

	const hashedPassword = await bcrypt.hash(password, 8);

	const otpValue = generateOtp(email);

	const userRegistrationKey = registrationDataKey(email);
	const redisUserDataPayload = {
		name,
		email,
		password: hashedPassword,
	};

	try {
		await redisClient.set(
			userRegistrationKey,
			JSON.stringify(redisUserDataPayload),
			{
				expiration: {
					type: "EX",
					value: OTP_SESSION_EXPIRATION_SECONDS,
				},
			},
		);

		await resetResendCount("REGISTRATION", email);
		await resetOtpAttempts("REGISTRATION", email);

		await storeOtp(registrationOtpKey(email), otpValue);

		await sendOtpEmail({
			template: "registerUser.ejs",
			subject: "Email Verification",
			name,
			email,
			otp: otpValue,
		});
	} catch (error) {
		await redisClient.del(userRegistrationKey);
		await redisClient.del(registrationOtpKey(email));
		await releaseResendCooldown("REGISTRATION", email);
		await resetResendCount("REGISTRATION", email);
		throw error;
	}

	return buildOtpIssueResult("REGISTRATION", email, 0);
};

const verifyEmail = async (payload: IVerifyEmailPayload) => {
	const otp = payload.otp;
	const email = payload.email.trim().toLowerCase();

	const isUserExist = await prisma.user.findUnique({
		where: {
			email,
		},
	});

	if (isUserExist?.status === Status.SUSPENDED) {
		throw new AppError(httpStatus.FORBIDDEN, "User is Suspended");
	}

	if (isUserExist?.emailVerified) {
		throw new AppError(httpStatus.CONFLICT, "Email ALready Verified");
	}

	if (isUserExist?.isDeleted || isUserExist?.status === "DELETED") {
		throw new AppError(httpStatus.FORBIDDEN, "User is Deleted");
	}

	const otpKey = registrationOtpKey(email);
	const userRegistrationKey = registrationDataKey(email);

	const [redisOtp, redisUserData] = await Promise.all([
		redisClient.get(otpKey),
		redisClient.get(userRegistrationKey),
	]);

	if (!redisUserData) {
		await clearRegistrationSession(email);
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"No pending registration found for this email. Please register again.",
		);
	}

	if (!redisOtp) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Verification code has expired. Please request a new one.",
		);
	}

	if (redisOtp !== otp) {
		const attempts = await recordOtpAttempt("REGISTRATION", email);

		if (attempts >= MAX_OTP_ATTEMPTS) {
			await redisClient.del([otpKey, otpAttemptKey("REGISTRATION", email)]);
			throw new AppError(
				httpStatus.TOO_MANY_REQUESTS,
				"Too many incorrect attempts. Please request a new verification code.",
			);
		}

		throw new AppError(
			httpStatus.BAD_REQUEST,
			`Incorrect verification code. ${MAX_OTP_ATTEMPTS - attempts} attempt(s) left.`,
		);
	}

	const userPayload: IRegisterUser = JSON.parse(redisUserData);

	const createdUser = await prisma.user.create({
		data: {
			name: userPayload.name,
			email: userPayload.email,
			password: userPayload.password,
			role: Role.USER,
			status: Status.ACTIVE,
			emailVerified: true,
			profile: {
				create: {},
			},
		},
		omit: { password: true },
		include: {
			profile: true,
		},
	});

	await clearRegistrationSession(email);

	const templatePath = path.join(
		process.cwd(),
		"src/app/template/user-welcome-email.ejs",
	);

	const templateData = {
		name: createdUser.name,
		email: createdUser.email,
		appUrl: config.frontend_url,
	};

	const html = await ejs.renderFile(templatePath, templateData);

	await transporter.sendMail({
		from: config.email_sender,
		to: email,
		subject: "Welcome To MessTally",
		html,
	});

	const { ...user } = createdUser;
	const { accessToken, refreshToken } = await createAuthTokens({
		id: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	});

	return {
		user,
		accessToken,
		refreshToken,
	};
};

const loginUser = async (payload: ILoginUser) => {
	const { password } = payload;

	const email = payload.email.trim().toLowerCase();

	const user = await prisma.user.findUnique({
		where: {
			email,
		},
	});
	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
	}
	if (user.status === Status.SUSPENDED) {
		throw new AppError(httpStatus.FORBIDDEN, "User is Suspended");
	}

	if (user.isDeleted || user.status === Status.DELETED) {
		throw new AppError(httpStatus.FORBIDDEN, "User is deleted");
	}

	const isPasswordMatched = await bcrypt.compare(
		password,
		user.password as string,
	);

	if (!isPasswordMatched) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Invalid credentials");
	}
	const { accessToken, refreshToken } = await createAuthTokens({
		id: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	});

	const mess = await getActiveMess(user.activeMessId);

	return {
		accessToken,
		refreshToken,
		activeMessId: user.activeMessId,
		mess,
	};
};
const getMe = async (user: IRequestUser) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
		include: {
			profile: true,
		},
		omit: {
			password: true,
		},
	});

	if (!isUserExists) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	return isUserExists;
};
const refreshToken = async (token: string) => {
	const verifiedRefreshToken = jwtUtils.verifyToken(
		token,
		config.jwt_refresh_secret,
	);

	if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			config.node_env === "development"
				? verifiedRefreshToken.error
				: "Invalid refresh token",
		);
	}

	const data = verifiedRefreshToken.data as JwtPayload;

	const user = await prisma.user.findUnique({
		where: {
			id: data.userId,
		},
	});

	if (!user || user.isDeleted || user.status !== Status.ACTIVE) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User is inactive or not found",
		);
	}

	const { accessToken, refreshToken } = await createAuthTokens({
		id: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	});

	const mess = await getActiveMess(user.activeMessId);

	return {
		accessToken,
		refreshToken,
		activeMessId: user.activeMessId,
		mess,
	};
};

const forgotPassword = async (payload: IForgotPasswordPayload) => {
	const email = payload.email.trim().toLowerCase();

	const user = await prisma.user.findUnique({
		where: {
			email,
		},
	});

	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	if (user.status === Status.SUSPENDED) {
		throw new AppError(httpStatus.FORBIDDEN, "User is suspended");
	}

	if (user.isDeleted || user.status === Status.DELETED) {
		throw new AppError(httpStatus.FORBIDDEN, "User is deleted");
	}

	if (!user.emailVerified) {
		throw new AppError(httpStatus.FORBIDDEN, "Email is not verified");
	}

	await acquireResendCooldown("FORGOT_PASSWORD", email);

	const otpValue = generateOtp(email);

	try {
		await redisClient.set(
			forgotPasswordSessionKey(email),
			JSON.stringify({ userId: user.id }),
			{
				expiration: {
					type: "EX",
					value: OTP_SESSION_EXPIRATION_SECONDS,
				},
			},
		);

		await resetResendCount("FORGOT_PASSWORD", email);
		await resetOtpAttempts("FORGOT_PASSWORD", email);

		await storeOtp(forgotPasswordOtpKey(email), otpValue);

		await sendOtpEmail({
			template: "forgotPassword.ejs",
			subject: "Forgot Password",
			name: user.name,
			email,
			otp: otpValue,
		});
	} catch (error) {
		await redisClient.del(forgotPasswordSessionKey(email));
		await redisClient.del(forgotPasswordOtpKey(email));
		await releaseResendCooldown("FORGOT_PASSWORD", email);
		throw error;
	}

	return buildOtpIssueResult("FORGOT_PASSWORD", email, 0);
};

const resendOtp = async (payload: IResendOtpPayload) => {
	const email = payload.email.trim().toLowerCase();
	const { purpose } = payload;

	if (purpose === "REGISTRATION") {
		const pendingRegistration = await redisClient.get(
			registrationDataKey(email),
		);

		if (!pendingRegistration) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"No pending registration found for this email. Please register first.",
			);
		}

		const isUserExists = await prisma.user.findUnique({
			where: {
				email,
			},
			select: {
				id: true,
			},
		});

		if (isUserExists) {
			await clearRegistrationSession(email);
			throw new AppError(
				httpStatus.CONFLICT,
				"This email is already registered. Please log in.",
			);
		}

		const pendingUser: IRegisterUser = JSON.parse(pendingRegistration);

		const resendsUsed = await reserveResendSlot("REGISTRATION", email);

		const otpValue = generateOtp(email);

		await storeOtp(registrationOtpKey(email), otpValue);
		await resetOtpAttempts("REGISTRATION", email);
		await redisClient.expire(
			registrationDataKey(email),
			OTP_SESSION_EXPIRATION_SECONDS,
		);

		try {
			await sendOtpEmail({
				template: "registerUser.ejs",
				subject: "Email Verification",
				name: pendingUser.name,
				email,
				otp: otpValue,
			});
		} catch (error) {
			await rollbackResendSlot("REGISTRATION", email);
			throw error;
		}

		return buildOtpIssueResult(purpose, email, resendsUsed);
	}

	const pendingSession = await redisClient.get(forgotPasswordSessionKey(email));

	if (!pendingSession) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"No pending password reset found for this email. Please request a password reset first.",
		);
	}

	const user = await prisma.user.findUnique({
		where: {
			email,
		},
	});

	if (!user) {
		await clearForgotPasswordSession(email);
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	if (user.status === Status.SUSPENDED) {
		throw new AppError(httpStatus.FORBIDDEN, "User is suspended");
	}

	if (user.isDeleted || user.status === Status.DELETED) {
		throw new AppError(httpStatus.FORBIDDEN, "User is deleted");
	}

	if (!user.emailVerified) {
		throw new AppError(httpStatus.FORBIDDEN, "Email is not verified");
	}

	const resendsUsed = await reserveResendSlot("FORGOT_PASSWORD", email);

	const otpValue = generateOtp(email);

	await storeOtp(forgotPasswordOtpKey(email), otpValue);
	await resetOtpAttempts("FORGOT_PASSWORD", email);
	await redisClient.expire(
		forgotPasswordSessionKey(email),
		OTP_SESSION_EXPIRATION_SECONDS,
	);

	try {
		await sendOtpEmail({
			template: "forgotPassword.ejs",
			subject: "Forgot Password",
			name: user.name,
			email,
			otp: otpValue,
		});
	} catch (error) {
		await rollbackResendSlot("FORGOT_PASSWORD", email);
		throw error;
	}

	return buildOtpIssueResult(purpose, email, resendsUsed);
};

const resetPassword = async (payload: IResetPasswordPayload) => {
	const email = payload.email.trim().toLowerCase();
	const { newPassword, otp } = payload;

	const user = await prisma.user.findUnique({
		where: {
			email,
		},
	});

	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	if (user.status === Status.SUSPENDED) {
		throw new AppError(httpStatus.FORBIDDEN, "User is suspended");
	}

	if (user.isDeleted || user.status === Status.DELETED) {
		throw new AppError(httpStatus.FORBIDDEN, "User is deleted");
	}

	if (!user.emailVerified) {
		throw new AppError(httpStatus.FORBIDDEN, "Email is not verified");
	}

	const otpKey = forgotPasswordOtpKey(email);

	const redisOtp = await redisClient.get(otpKey);

	if (!redisOtp) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Password reset code has expired. Please request a new one.",
		);
	}

	if (redisOtp !== otp) {
		const attempts = await recordOtpAttempt("FORGOT_PASSWORD", email);

		if (attempts >= MAX_OTP_ATTEMPTS) {
			await redisClient.del([otpKey, otpAttemptKey("FORGOT_PASSWORD", email)]);
			throw new AppError(
				httpStatus.TOO_MANY_REQUESTS,
				"Too many incorrect attempts. Please request a new password reset code.",
			);
		}

		throw new AppError(
			httpStatus.BAD_REQUEST,
			`Incorrect password reset code. ${MAX_OTP_ATTEMPTS - attempts} attempt(s) left.`,
		);
	}

	const hashedPassword = await bcrypt.hash(newPassword, 8);

	await prisma.user.update({
		where: {
			email,
		},
		data: {
			password: hashedPassword,
		},
	});

	await clearForgotPasswordSession(email);

	const templatePath = path.join(
		process.cwd(),
		"src/app/template/password-reset-success.ejs",
	);

	const templateData = {
		name: user.name,
		email,
		appUrl: config.frontend_url,
	};
	const html = await ejs.renderFile(templatePath, templateData);

	await transporter.sendMail({
		from: config.email_sender,
		to: email,
		subject: "Password Reset Successful",
		html,
	});
};

export const authService = {
	registerUser,
	verifyEmail,
	loginUser,
	getMe,
	refreshToken,
	forgotPassword,
	resendOtp,
	resetPassword,
};
