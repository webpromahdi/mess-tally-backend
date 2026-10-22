import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { depositController } from "./deposit.controller";
import { createDepositSchema, updateDepositSchema } from "./deposit.validation";

const router = Router();

// Reads are open to any ACTIVE member; the service adds `assertManager` on
// every write (D5). Mess scope still comes from `user.activeMessId`.
router.get("/", auth(), depositController.listDeposits);
router.post(
	"/",
	auth(),
	validateRequest(createDepositSchema),
	depositController.createDeposit,
);
router.patch(
	"/:id",
	auth(),
	validateRequest(updateDepositSchema),
	depositController.updateDeposit,
);
router.delete("/:id", auth(), depositController.deleteDeposit);

export const depositRoutes = router;
