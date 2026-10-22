import { z } from "zod";
import { checkEmailDomain } from "../../lib/emailDomain";

const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const TLD = /^[A-Za-z]{2,63}$/;

const email = z
	.string({ error: "Email is required" })
	.trim()
	.toLowerCase()
	.max(254, "Email must be at most 254 characters")
	.pipe(z.email("Enter a valid email address, e.g. name@example.com"))
	.refine((value) => {
		const at = value.lastIndexOf("@");
		const local = value.slice(0, at);
		const labels = value.slice(at + 1).split(".");

		return (
			local.length <= 64 &&
			labels.length >= 2 &&
			labels.every((label) => DOMAIN_LABEL.test(label)) &&
			TLD.test(labels[labels.length - 1])
		);
	}, "Enter a valid email address with a proper domain, e.g. name@example.com");

// Only checked on registration so the domain must actually be able to receive
// mail (catches typos like gmail.co, which has a null MX record). Login and the
// OTP flows stay pure string validation so they never depend on DNS.
const deliverableEmail = email.superRefine(async (value, ctx) => {
	const domain = value.slice(value.lastIndexOf("@") + 1);
	const result = await checkEmailDomain(domain);

	if (!result.ok) {
		ctx.addIssue({ code: "custom", message: result.message });
	}
});

const password = z
	.string({ error: "Password is required" })
	.min(8, "Password must be at least 8 characters")
	.refine(
		(value) => Buffer.byteLength(value, "utf8") <= 72,
		"Password must be at most 72 bytes",
	)
	.refine(
		(value) => /[A-Za-z]/.test(value) && /\d/.test(value),
		"Password must contain at least one letter and one number",
	);

const newPassword = z
	.string({ error: "Password is required" })
	.min(8, "Password must be at least 8 characters")
	.refine(
		(value) => Buffer.byteLength(value, "utf8") <= 72,
		"Password must be at most 72 bytes",
	)
	.refine(
		(value) => /[A-Za-z]/.test(value) && /\d/.test(value),
		"Password must contain at least one letter and one number",
	);

export const registerUserSchema = z.object({
	name: z
		.string({ error: "Name is required" })
		.trim()
		.min(2, "Name must be at least 2 characters")
		.max(80, "Name must be at most 80 characters")
		.regex(
			/^[\p{L}\p{M} .'-]+$/u,
			"Name may only contain letters, spaces, dots, apostrophes and hyphens",
		),
	email: deliverableEmail,
	password,
});

export const verifyEmailSchema = z.object({
	email,
	otp: z
		.string({ error: "Verification code must be provided as text" })
		.regex(/^\d{6}$/, "Verification code must be exactly 6 digits"),
});

export const loginUserSchema = z.object({
	email,
	password: z
		.string({ error: "Password is required" })
		.min(1, "Password is required")
		.refine(
			(value) => Buffer.byteLength(value, "utf8") <= 72,
			"Password must be at most 72 bytes",
		),
});

export const forgotPasswordSchema = z.object({
	email,
});

export const resetPasswordSchema = z.object({
	email,
	newPassword,
	otp: z
		.string({ error: "Verification code must be provided as text" })
		.regex(/^\d{6}$/, "Verification code must be exactly 6 digits"),
});

export type TRegisterUser = z.infer<typeof registerUserSchema>;
export type TVerifyEmail = z.infer<typeof verifyEmailSchema>;
export type TLoginUser = z.infer<typeof loginUserSchema>;
export type TForgotPassword = z.infer<typeof forgotPasswordSchema>;
export type TResetPassword = z.infer<typeof resetPasswordSchema>;
