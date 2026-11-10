/**
 * Change 0006's bridge until its task 7 gives the District CRPO a release screen: the District's release of
 * cases the Ministry allocated, written straight to the development database (tests/ds-release-bridge.ts).
 * Run as `npx tsx tests/e2e/ds-release-bridge.ts <case id>...`, in a process of its own, as the global
 * setup runs cleanup.ts: Playwright's loader can't load the Prisma client.
 */
import "dotenv/config";
import { sampleUsersAllowed } from "../../prisma/seed-users";
import { createPrismaClient } from "../../src/server/db";
import { releaseToDsForTests } from "../ds-release-bridge";

async function main() {
  if (!sampleUsersAllowed()) throw new Error("The test bridge only runs on development and test databases.");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const db = createPrismaClient(databaseUrl);
  try {
    await releaseToDsForTests(db, process.argv.slice(2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
