import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { dashboardController } from "./dashboard.controller";

const router = Router();

// Identity only; mess scope is resolved from `user.activeMessId` inside the
// service. Dashboard reads never create a month row.
router.get(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	dashboardController.getDashboard,
);

export const dashboardRoutes = router;
