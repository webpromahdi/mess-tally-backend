import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { summaryController } from "./summary.controller";

const router = Router();

// Identity only; mess scope is resolved from `user.activeMessId` inside the
// service. Summary reads never create a month row.
router.get(
	"/export",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	summaryController.exportSummary,
);
router.get(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	summaryController.getSummary,
);
router.get(
	"/statement",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	summaryController.getStatement,
);

export const summaryRoutes = router;
