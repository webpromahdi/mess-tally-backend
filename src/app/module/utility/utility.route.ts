import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { utilityController } from "./utility.controller";
import {
	createUtilitySchema,
	updateUtilitySchema,
	utilityPaidSchema,
} from "./utility.validation";

const router = Router();

// Identity only; mess scope is resolved from `user.activeMessId` in the
// service. No mess id is read from the body or added to the JWT (D7).
router.get(
	"/fund",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	utilityController.getUtilityFund,
);
router.get(
	"/replenishment-estimate",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	utilityController.getReplenishmentEstimate,
);
router.get(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	utilityController.listUtilities,
);
router.post(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(createUtilitySchema),
	utilityController.createUtility,
);
router.patch(
	"/:id/paid",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(utilityPaidSchema),
	utilityController.setUtilityPaid,
);
router.patch(
	"/:id",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(updateUtilitySchema),
	utilityController.updateUtility,
);
router.delete(
	"/:id",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	utilityController.deleteUtility,
);

export const utilityRoutes = router;
