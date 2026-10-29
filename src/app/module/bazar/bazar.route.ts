import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { upload } from "../../lib/multer";
import { validateRequest } from "../../middleware/validateRequest";
import { bazarController } from "./bazar.controller";
import { createBazarSchema, updateBazarSchema } from "./bazar.validation";

const router = Router();

// Identity only; mess scope comes from `user.activeMessId`. No mess id is read
// from the body or added to the JWT (D7).
router.get(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	bazarController.listBazar,
);
router.post(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(createBazarSchema),
	bazarController.createBazar,
);
router.patch(
	"/:id",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(updateBazarSchema),
	bazarController.updateBazar,
);
router.delete(
	"/:id",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	bazarController.deleteBazar,
);
router.post(
	"/:id/receipt",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	upload.single("receipt"),
	bazarController.uploadReceipt,
);
router.delete(
	"/:id/receipt",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	bazarController.deleteReceipt,
);

export const bazarRoutes = router;
