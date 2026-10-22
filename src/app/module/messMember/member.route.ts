import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { memberController } from "./member.controller";

const router = Router();

// Every route is identity-guarded here; mess scope and role checks happen in
// the service through `requireActiveMembership` / `assertManager` (plus the
// OWNER role for the manager-transfer escape hatch), so the JWT never carries
// a mess id (decisions D7, D14).
router.get("/members", auth(), memberController.listMembers);
router.get("/members/pending", auth(), memberController.listPendingMembers);

router.patch("/members/:id/approve", auth(), memberController.approveMember);
router.patch("/members/:id/reject", auth(), memberController.rejectMember);
router.patch("/members/:id/manager", auth(), memberController.transferManager);
router.patch("/members/:id/owner", auth(), memberController.transferOwnership);
router.delete("/members/:id", auth(), memberController.removeMember);

router.post("/leave", auth(), memberController.leaveMess);

export const messMemberRoutes = router;
