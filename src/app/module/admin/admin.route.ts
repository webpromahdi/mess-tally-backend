import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { adminController } from "./admin.controller";
import {
	grantProSchema,
	updateUserRoleSchema,
	updateUserStatusSchema,
} from "./admin.validation";

const router = Router();

// Platform staff only. Everything below is cross-mess, so no mess scope applies.
router.use(auth(Role.ADMIN, Role.SUPERADMIN));

router.get("/overview", adminController.getOverview);

router.get("/users", adminController.listUsers);
router.patch(
	"/users/:id/status",
	validateRequest(updateUserStatusSchema),
	adminController.updateUserStatus,
);
router.patch(
	"/users/:id/role",
	auth(Role.SUPERADMIN),
	validateRequest(updateUserRoleSchema),
	adminController.updateUserRole,
);

router.get("/messes", adminController.listMesses);
router.patch(
	"/messes/:id/plan",
	validateRequest(grantProSchema),
	adminController.grantPro,
);

router.get("/revenue", adminController.getRevenue);

export const adminRoutes = router;
