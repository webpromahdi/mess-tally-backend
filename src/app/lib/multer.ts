import multer from "multer";
import httpStatus from "http-status";
import { AppError } from "../utils/AppError";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = new Set([
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
]);

const storage = multer.memoryStorage();

export const upload = multer({
	storage,
	limits: {
		fileSize: MAX_FILE_SIZE,
	},
	fileFilter: (_req, file, cb) => {
		if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
			return cb(
				new AppError(
					httpStatus.BAD_REQUEST,
					"Only JPEG, PNG, and WebP images are allowed",
				),
			);
		}

		cb(null, true);
	},
});
