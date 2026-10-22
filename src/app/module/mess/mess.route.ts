import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { messController } from "./mess.controller";
import { joinMessSchema } from "./mess.validations";

const router = Router();

router.post("/", auth(), messController.createMess);
router.post("/join",auth(), validateRequest(joinMessSchema),messController.joinMess);

export const messRoutes = router;
