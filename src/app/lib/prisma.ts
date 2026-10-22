import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;

/**
 * Prisma Postgres (`pooled.db.prisma.io`) multiplexes connections behind a
 * pooler that can drop idle sockets and cold-start after a suspend.
 *
 * - `keepAlive` lets the TCP layer notice a dead pooled socket instead of
 *   handing it to the next query.
 * - `connectionTimeoutMillis` fails a bad connect in 10s instead of waiting
 *   for the OS TCP timeout (which surfaces as the raw `ETIMEDOUT` error).
 * - `idleTimeoutMillis` recycles idle clients before the pooler does.
 *
 * The global error handler maps the remaining transient connection errors to
 * `503 Service Unavailable` so clients know to retry.
 */
const adapter = new PrismaPg({
	connectionString,
	keepAlive: true,
	connectionTimeoutMillis: 10_000,
	idleTimeoutMillis: 30_000,
});

const prisma = new PrismaClient({ adapter });

export { prisma };
