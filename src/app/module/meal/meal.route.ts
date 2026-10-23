import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { mealController } from "./meal.controller";
import {
	bulkUpsertMealSchema,
	selfMealSchema,
	upsertMealSchema,
} from "./meal.validation";

const router = Router();

// Identity only; mess scope is resolved from `user.activeMessId` inside the
// service. No mess id is read from the body or added to the JWT (D7).
router.get(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	mealController.getMealGrid,
);
router.put(
	"/",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(upsertMealSchema),
	mealController.upsertMeal,
);
router.patch(
	"/me",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(selfMealSchema),
	mealController.updateOwnMeal,
);
router.post(
	"/bulk",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(bulkUpsertMealSchema),
	mealController.bulkUpsertMeals,
);
router.delete(
	"/:id",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	mealController.deleteMeal,
);

export const mealRoutes = router;
