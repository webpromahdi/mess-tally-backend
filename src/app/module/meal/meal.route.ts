import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { mealController } from "./meal.controller";
import { bulkUpsertMealSchema, upsertMealSchema } from "./meal.validation";

const router = Router();

// Identity only; mess scope is resolved from `user.activeMessId` inside the
// service. No mess id is read from the body or added to the JWT (D7).
router.get("/", auth(), mealController.getMealGrid);
router.put(
	"/",
	auth(),
	validateRequest(upsertMealSchema),
	mealController.upsertMeal,
);
router.post(
	"/bulk",
	auth(),
	validateRequest(bulkUpsertMealSchema),
	mealController.bulkUpsertMeals,
);
router.delete("/:id", auth(), mealController.deleteMeal);

export const mealRoutes = router;
