import type { UploadApiResponse } from "cloudinary";
import httpStatus from "http-status";
import { cloudinary } from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";

const uploadProfileImage = async (buffer: Buffer, userId: string) => {
	const currentProfile = await prisma.profile.findUnique({
		where: {
			userId,
		},
		select: {
			imageUrl: true,
			imagePublicId: true,
		},
	});

	const cloudinaryResult = await new Promise<UploadApiResponse>(
		(resolve, reject) => {
			cloudinary.uploader
				.upload_stream(
					{
						resource_type: "auto",
					},

					async (error, result) => {
						if (error) {
							return reject(error);
						}

						if (!result) {
							return reject(
								new AppError(
									httpStatus.INTERNAL_SERVER_ERROR,
									"No result returned",
								),
							);
						}

						resolve(result);
					},
				)
				.end(buffer);
		},
	);

	const updatedProfile = await prisma.profile.upsert({
		where: {
			userId,
		},
		create: {
			userId,
			imageUrl: cloudinaryResult.secure_url,
			imagePublicId: cloudinaryResult.public_id,
		},
		update: {
			imageUrl: cloudinaryResult.secure_url,
			imagePublicId: cloudinaryResult.public_id,
		},
	});

	if (currentProfile?.imagePublicId && currentProfile.imageUrl) {
		await cloudinary.uploader.destroy(currentProfile.imagePublicId);
	}

	return updatedProfile;
};

export const profileService = {
	uploadProfileImage,
};
