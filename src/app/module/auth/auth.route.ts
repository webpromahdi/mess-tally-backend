import { Router } from "express";
import { authController } from "./auth.controller";
import { validateRequest } from "../../middleware/validateRequest";
import {
	forgotPasswordSchema,
	loginUserSchema,
	registerUserSchema,
	resetPasswordSchema,
	verifyEmailSchema,
} from "./auth.validation";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.post(
	"/register",
	validateRequest(registerUserSchema),
	authController.registerUser,
);
router.post(
	"/verify-email",
	validateRequest(verifyEmailSchema),
	authController.verifyEmail,
);
router.post(
	"/login",
	validateRequest(loginUserSchema),
	authController.loginUser,
);
router.post(
	"/forgot-password",
	validateRequest(forgotPasswordSchema),
	authController.forgotPassword,
);
router.post(
	"/reset-password",
	validateRequest(resetPasswordSchema),
	authController.resetPassword,
);
router.get(
	"/me",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	authController.getMe,
);
router.post("/refresh-token", authController.refreshToken);

export const AuthRoutes = router;
