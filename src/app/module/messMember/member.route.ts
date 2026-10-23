import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { memberController } from "./member.controller";

const router = Router();

// Every route is identity-guarded here; mess scope and role checks happen in
// the service through `requireActiveMembership` / `assertManager` (plus the
// OWNER role for the manager-transfer escape hatch), so the JWT never carries
// a mess id (decisions D7, D14).
router.get(
	"/members",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	memberController.listMembers,
);
router.get(
	"/members/pending",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	memberController.listPendingMembers,
);

router.patch(
	"/members/:id/approve",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	memberController.approveMember,
);
router.patch(
	"/members/:id/reject",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	memberController.rejectMember,
);
router.patch(
	"/members/:id/manager",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	memberController.transferManager,
);
router.patch(
	"/members/:id/owner",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	memberController.transferOwnership,
);
router.delete(
	"/members/:id",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	memberController.removeMember,
);

router.post(
	"/leave",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	memberController.leaveMess,
);

export const messMemberRoutes = router;
