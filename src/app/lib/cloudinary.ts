import { v2 as Cloudinary } from "cloudinary";
import type { UploadApiResponse } from "cloudinary";
import httpStatus from "http-status";
import config from "../config";
import { AppError } from "../utils/AppError";

// Configure Cloudinary (use your own cloud_name, api_key, and api_secret)
Cloudinary.config({
	cloud_name: config.cloudinary_cloud_name,
	api_key: config.cloudinary_api_key,
	api_secret: config.cloudinary_api_secret,
});

export const cloudinary = Cloudinary;

/**
 * Uploads an in-memory buffer (multer) to Cloudinary and resolves with the
 * public id + secure URL. Resource type is locked to image — same as profile
 * picture uploads.
 */
export const uploadImageBuffer = async (
	buffer: Buffer,
	folder: string,
): Promise<UploadApiResponse> =>
	new Promise<UploadApiResponse>((resolve, reject) => {
		cloudinary.uploader
			.upload_stream({ resource_type: "image", folder }, (error, result) => {
				if (error) {
					reject(
						new AppError(
							httpStatus.INTERNAL_SERVER_ERROR,
							`Failed to upload image: ${error.message}`,
						),
					);
					return;
				}

				if (!result) {
					reject(
						new AppError(
							httpStatus.INTERNAL_SERVER_ERROR,
							"No result returned from image upload",
						),
					);
					return;
				}

				resolve(result);
			})
			.end(buffer);
	});

/** Deletes an asset. Never blocks the DB write on an upload cleanup failure. */
export const destroyCloudinaryAsset = async (
	publicId: string | null | undefined,
): Promise<void> => {
	if (!publicId) {
		return;
	}

	try {
		await cloudinary.uploader.destroy(publicId);
	} catch (error) {
		console.error(
			`Failed to delete Cloudinary asset "${publicId}"`,
			error instanceof Error ? error.message : error,
		);
	}
};
