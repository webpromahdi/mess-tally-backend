import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { bazarController } from "./bazar.controller";
import { createBazarSchema, updateBazarSchema } from "./bazar.validation";

const router = Router();

// Identity only; mess scope comes from `user.activeMessId`. No mess id is read
// from the body or added to the JWT (D7).
router.get("/", auth(), bazarController.listBazar);
router.post(
	"/",
	auth(),
	validateRequest(createBazarSchema),
	bazarController.createBazar,
);
router.patch(
	"/:id",
	auth(),
	validateRequest(updateBazarSchema),
	bazarController.updateBazar,
);
router.delete("/:id", auth(), bazarController.deleteBazar);

export const bazarRoutes = router;
