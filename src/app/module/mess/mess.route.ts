import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { messController } from "./mess.controller";
import { joinMessSchema } from "./mess.validations";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.post(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	messController.createMess,
);
router.get(
	"/my",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	messController.getMyMesses,
);
router.post(
	"/join",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(joinMessSchema),
	messController.joinMess,
);

export const messRoutes = router;
