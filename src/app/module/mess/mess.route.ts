import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { messController } from "./mess.controller";
import { joinMessSchema } from "./mess.validations";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

router.post("/", auth(Role.USER), messController.createMess);
router.get("/my", auth(Role.USER), messController.getMyMesses);
router.post("/join",auth(Role.USER),validateRequest(joinMessSchema),messController.joinMess,);

export const messRoutes = router;
