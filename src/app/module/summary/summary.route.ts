import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { summaryController } from "./summary.controller";

const router = Router();

// Identity only; mess scope is resolved from `user.activeMessId` inside the
// service. Summary reads never create a month row.
router.get("/", auth(), summaryController.getSummary);

export const summaryRoutes = router;
