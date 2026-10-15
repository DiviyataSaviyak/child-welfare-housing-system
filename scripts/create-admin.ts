/**
 * The first admin account (ADM-2, AUTH-3). Sample accounts never exist outside development and
 * tests, so on the server this is how the first admin comes to be. They get a generated username
 * and a temporary password, shown once, which they change at first sign-in. The audit record names
 * the system as the one who acted.
 *
 *   npx tsx scripts/create-admin.ts --name "ආර්. සිල්වා" --mobile 0712345678
 *     [--designation "..."] [--email someone@example.lk] [--another]
 *
 * On the server: deploy/ec2/stack/scripts/create-admin.sh with the same flags. It refuses while an active
 * admin exists, who would create the account on the users screen instead; --another adds one
 * anyway, for when no admin can sign in.
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "../src/generated/prisma/client";
import { accountSchema } from "../src/lib/validation/user";
import { createPrismaClient } from "../src/server/db";
import { createAccount, type Credentials } from "../src/server/users/commands";
import { activeAdminCount } from "../src/server/users/queries";

export type AdminDetails = { name: string; mobile: string; designation?: string; email?: string };

export type CreateAdminResult =
  { ok: true; credentials: Credentials } | { ok: false; error: "adminExists" | "invalid"; detail?: string };

export async function createAdmin(
  db: PrismaClient,
  details: AdminDetails,
  options: { another?: boolean } = {},
): Promise<CreateAdminResult> {
  if (!options.another && (await activeAdminCount(db)) > 0) return { ok: false, error: "adminExists" };

  const parsed = accountSchema.safeParse({
    name: details.name,
    designation: details.designation ?? "",
    mobile: details.mobile,
    contactEmail: details.email ?? "",
    role: "ADMIN",
    dsOfficeId: "",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: "invalid", detail: `${issue?.path.join(".")}: ${issue?.message}` };
  }

  const created = await createAccount(db, null, parsed.data);
  if (!created.ok) return { ok: false, error: "invalid", detail: created.error };
  return { ok: true, credentials: created.value };
}

// Run directly: see the top of this file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const option = (name: string) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
  };
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const prisma = createPrismaClient(databaseUrl);

  const run = async () => {
    const result = await createAdmin(
      prisma,
      {
        name: option("--name") ?? "",
        mobile: option("--mobile") ?? "",
        designation: option("--designation"),
        email: option("--email"),
      },
      { another: process.argv.includes("--another") },
    );
    if (!result.ok) {
      console.error(
        result.error === "adminExists"
          ? "An active admin exists already: they create accounts on the users screen. Use --another only when no admin can sign in."
          : `The details were refused (${result.detail}). Usage: --name "<name>" --mobile <07XXXXXXXX> [--designation "<title>"] [--email <address>]`,
      );
      process.exitCode = 1;
      return;
    }
    // Shown once, here only: only its hash is stored (ADM-2).
    console.log(`Admin account created for ${(option("--name") ?? "").trim()}.
  Username:           ${result.credentials.username}
  Temporary password: ${result.credentials.temporaryPassword}
Give these to the admin in person. They set their own password at first sign-in.`);
  };
  run()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
