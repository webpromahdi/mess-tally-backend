/**
 * Creates (or promotes) the platform SUPERADMIN from `.env`:
 *   SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_NAME (optional)
 *
 * Run from the repo root: `npm run seed:admin`. Safe to run repeatedly.
 * An existing account keeps its password; only role/verification/status change.
 */
import bcrypt from "bcryptjs";
import { Role, Status } from "../generated/prisma/enums";
import { prisma } from "../app/lib/prisma";

const main = async () => {
	const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
	const password = process.env.SUPER_ADMIN_PASSWORD;
	const name = process.env.SUPER_ADMIN_NAME?.trim() || "Super Admin";

	if (!email || !password) {
		throw new Error(
			"Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env before seeding.",
		);
	}

	const existing = await prisma.user.findUnique({ where: { email } });

	if (existing) {
		await prisma.user.update({
			where: { id: existing.id },
			data: {
				role: Role.SUPERADMIN,
				emailVerified: true,
				status: Status.ACTIVE,
				isDeleted: false,
				deletedAt: null,
			},
		});
		console.log(`Promoted existing user ${email} to SUPERADMIN.`);
		return;
	}

	await prisma.user.create({
		data: {
			email,
			name,
			// Same cost as registration (auth.service.ts).
			password: await bcrypt.hash(password, 8),
			role: Role.SUPERADMIN,
			emailVerified: true,
			status: Status.ACTIVE,
			profile: { create: {} },
		},
	});
	console.log(`Created SUPERADMIN ${email}.`);
};

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
