import { Router } from "express";
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
router.get("/fund", auth(), utilityController.getUtilityFund);
router.get(
	"/replenishment-estimate",
	auth(),
	utilityController.getReplenishmentEstimate,
);
router.get("/", auth(), utilityController.listUtilities);
router.post(
	"/",
	auth(),
	validateRequest(createUtilitySchema),
	utilityController.createUtility,
);
router.patch(
	"/:id/paid",
	auth(),
	validateRequest(utilityPaidSchema),
	utilityController.setUtilityPaid,
);
router.patch(
	"/:id",
	auth(),
	validateRequest(updateUtilitySchema),
	utilityController.updateUtility,
);
router.delete("/:id", auth(), utilityController.deleteUtility);

export const utilityRoutes = router;
