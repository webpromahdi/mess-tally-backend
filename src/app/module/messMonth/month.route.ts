import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { monthController } from "./month.controller";
import { openMonthSchema } from "./month.validation";

const router = Router();

// Identity only. Mess scope comes from `requireActiveMembership`, which reads
// `user.activeMessId`; no mess claim is ever added to the JWT (D7).
router.get(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	monthController.listMonths,
);
router.post(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(openMonthSchema),
	monthController.openMonth,
);
router.patch(
	"/:id/close",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	monthController.closeMonth,
);
router.patch(
	"/:id/reopen",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	monthController.reopenMonth,
);

export const monthRoutes = router;
