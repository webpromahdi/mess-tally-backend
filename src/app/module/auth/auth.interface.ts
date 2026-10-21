import { Role } from "../../../generated/prisma/enums";

export interface ILoginUser {
    email: string;
    password: string;
}
export interface IRequestUser {
	userId: string;
	email: string;
	name: string;
	role: Role;
}
export interface IRegisterUser {
	name: string;
	email: string;
	password: string;
}
export interface IForgotPasswordPayload {
	email: string;
}
export interface IResetPasswordPayload {
	email: string;
	newPassword: string;
	otp: string;
}
export interface IVerifyEmailPayload {
	email: string;
	otp: string;
}