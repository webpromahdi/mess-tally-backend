import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { UserController } from "./profile.controller";

const router = Router();

router.patch("/profile_image", auth(Role.USER, Role.SUPERADMIN, Role.ADMIN), upload.single("profileImage"), UserController.uploadProfileImage)

export const ProfileRoute = router;