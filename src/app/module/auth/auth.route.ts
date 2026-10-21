import { Router } from "express";
import { authController } from "./auth.controller";
import { validateRequest } from "../../middleware/validateRequest";
import {
    loginUserSchema,
    registerUserSchema,
    verifyEmailSchema,
} from "./auth.validation";

const router = Router();

router.post('/register', validateRequest(registerUserSchema), authController.registerUser);
router.post('/verify-email', validateRequest(verifyEmailSchema), authController.verifyEmail);
router.post('/login', validateRequest(loginUserSchema), authController.loginUser);

export const AuthRoutes = router;