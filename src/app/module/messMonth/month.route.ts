import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { monthController } from "./month.controller";
import { openMonthSchema } from "./month.validation";

const router = Router();

// Identity only. Mess scope comes from `requireActiveMembership`, which reads
// `user.activeMessId`; no mess claim is ever added to the JWT (D7).
router.get("/", auth(), monthController.listMonths);
router.post(
	"/",
	auth(),
	validateRequest(openMonthSchema),
	monthController.openMonth,
);

export const monthRoutes = router;
