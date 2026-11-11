/**
 * Change 0006's bridge until its task 8 lets installment 1 move a case on: cases whose allocation their DS
 * received move to IN_PROGRESS, written straight to the development database (tests/ds-release-bridge.ts).
 * Run as `npx tsx tests/e2e/ds-release-bridge.ts <case id>...`, in a process of its own, as the global
 * setup runs cleanup.ts: Playwright's loader can't load the Prisma client.
 */
import "dotenv/config";
import { sampleUsersAllowed } from "../../prisma/seed-users";
import { createPrismaClient } from "../../src/server/db";
import { startForTests } from "../ds-release-bridge";

async function main() {
  if (!sampleUsersAllowed()) throw new Error("The test bridge only runs on development and test databases.");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const db = createPrismaClient(databaseUrl);
  try {
    await startForTests(db, process.argv.slice(2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
