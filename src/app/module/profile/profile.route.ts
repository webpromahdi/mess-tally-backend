import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { upload } from "../../lib/multer";
import { profileController } from "./profile.controller";
import { updateProfileSchema } from "./profile.validate";

const router = Router();

router.patch(
	"/profile_image",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	upload.single("profileImage"),
	profileController.uploadProfileImage,
);

router.patch(
	"/update_profile",
	auth(Role.USER, Role.ADMIN, Role.SUPERADMIN),
	validateRequest(updateProfileSchema),
	profileController.updateProfile,
);

export const ProfileRoute = router;
