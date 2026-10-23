import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { dashboardController } from "./dashboard.controller";

const router = Router();

// Identity only; mess scope is resolved from `user.activeMessId` inside the
// service. Dashboard reads never create a month row.
router.get("/", auth(), dashboardController.getDashboard);

export const dashboardRoutes = router;
