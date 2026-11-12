import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { aiController } from "./ai.controller";
import { chatSchema } from "./ai.validation";

const router = Router();

router.post(
	"/chat",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(chatSchema),
	aiController.chat,
);

export const aiRoutes = router;
