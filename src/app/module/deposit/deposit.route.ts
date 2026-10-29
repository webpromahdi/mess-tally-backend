import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { depositController } from "./deposit.controller";
import { createDepositSchema, updateDepositSchema } from "./deposit.validation";

const router = Router();

// Reads are open to any ACTIVE member; the service adds `assertManager` on
// every write (D5). Mess scope still comes from `user.activeMessId`.
router.get(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	depositController.listDeposits,
);
router.post(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(createDepositSchema),
	depositController.createDeposit,
);
router.patch(
	"/:id",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(updateDepositSchema),
	depositController.updateDeposit,
);
router.delete(
	"/:id",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	depositController.deleteDeposit,
);

export const depositRoutes = router;
