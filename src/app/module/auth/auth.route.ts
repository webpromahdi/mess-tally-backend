import { Router } from "express";
import { authController } from "./auth.service";

const router = Router();

router.post('/login', authController.loginUser);

export const AuthRoutes = router;