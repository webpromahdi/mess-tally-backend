import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { subscriptionController } from "./subscription.controller";

const router = Router();
const roles = [Role.USER, Role.ADMIN, Role.SUPERADMIN] as const;

router.get("/callback", subscriptionController.paymentCallback);
router.get("/", auth(...roles), subscriptionController.getSubscription);
router.post("/activate", auth(...roles), subscriptionController.activateSubscription);
router.get("/payments", auth(...roles), subscriptionController.listPayments);
router.get(
	"/payments/:id/status",
	auth(...roles),
	subscriptionController.reconcilePayment,
);

export const subscriptionRoutes = router;
