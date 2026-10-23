/**
 * The release's own commands, which the Infrastructure repository runs by name in the tools image
 * (OPS-3). What they do inside follows the schema and may change freely. Their names, flags and
 * output are a contract: changing one needs a matching change to the Infrastructure repository's
 * ansible/roles/stack/files/scripts/lib.sh. The tools image has tsx on its PATH and no npx; in
 * development, put npx in front.
 *
 *   tsx scripts/tools.ts grants
 *     The app's own database account, diviyata_app, and what it may do (SEC-3), with the password in
 *     APP_DB_PASSWORD. Run after every migration; running it again changes nothing.
 *   tsx scripts/tools.ts pending-migrations [--unknown | --maintenance]
 *     The migrations this image carries that the database hasn't run, one name per line. With
 *     --unknown: the ones the database has run that this image doesn't carry. With --maintenance:
 *     the pending ones that can't run while the previous release still runs (a maintenance.md beside
 *     their migration.sql says why), so the deploy stops the app for them.
 *   tsx scripts/tools.ts create-admin --name "<name>" --mobile <07XXXXXXXX> [--designation "<title>"] [--email <address>] [--another]
 *     The first admin account (scripts/create-admin.ts).
 *
 * Each connects with DATABASE_URL, the database owner's account; its ?schema= names the schema
 * (public when absent), as for the app.
 */
import "dotenv/config";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

/** The app's own database account (SEC-3). */
export const APP_ROLE = "diviyata_app";

const MIGRATIONS = fileURLToPath(new URL("../prisma/migrations", import.meta.url));

/**
 * The note beside a migration.sql that can't run while the previous release still runs (CLAUDE.md,
 * "Migrations without downtime"). It says why; its being there stops the app while it runs.
 */
export const MAINTENANCE_NOTE = "maintenance.md";

/**
 * A password as PostgreSQL stores it (SCRAM-SHA-256, RFC 5803), so the words themselves never reach
 * the server: PostgreSQL logs a statement that fails, with its text. psql's \password does the same.
 * The passwords are ASCII, which SASLprep leaves as they are.
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest("base64");
  const serverKey = createHmac("sha256", salted).update("Server Key").digest("base64");
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey}:${serverKey}`;
}

/**
 * SEC-3: the app's account reads and writes rows, and nothing more. It owns nothing, so it can't
 * create, alter or drop a table; it may only add audit rows, never change or remove them (HIS-3; a
 * trigger on audit_log refuses that to everyone, the owner too); and it can't read the migrations'
 * own record. Every table counts, a new one too, so this runs after every migration, in one
 * transaction.
 */
export async function applyGrants(
  client: pg.Client,
  { role, schema, password }: { role: string; schema: string; password: string },
): Promise<void> {
  const { rows } = await client.query<{
    database: string;
    roleExists: boolean;
    auditLog: boolean;
    migrations: boolean;
  }>(
    `SELECT current_database() AS database,
            EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS "roleExists",
            to_regclass(format('%I.audit_log', $2::text)) IS NOT NULL AS "auditLog",
            to_regclass(format('%I._prisma_migrations', $2::text)) IS NOT NULL AS migrations`,
    [role, schema],
  );
  const facts = rows[0];
  if (!facts) throw new Error("The database didn't answer");
  const account = client.escapeIdentifier(role);
  const database = client.escapeIdentifier(facts.database);
  const space = client.escapeIdentifier(schema);
  const verifier = client.escapeLiteral(scramVerifier(password));

  const statements = [
    ...(facts.roleExists ? [] : [`CREATE ROLE ${account} LOGIN PASSWORD ${verifier}`]),
    // Keeps the password the one in the settings. NOSUPERUSER isn't named: on RDS the owner isn't a
    // superuser, and only a superuser may name that attribute; a role the owner made can't be one.
    `ALTER ROLE ${account} WITH LOGIN NOCREATEDB NOCREATEROLE PASSWORD ${verifier}`,
    `REVOKE ALL ON DATABASE ${database} FROM PUBLIC`,
    `GRANT CONNECT ON DATABASE ${database} TO ${account}`,
    `REVOKE CREATE ON SCHEMA ${space} FROM PUBLIC`,
    `GRANT USAGE ON SCHEMA ${space} TO ${account}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${space} TO ${account}`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${space} TO ${account}`,
    // Both tables are missing only in an empty database, such as one put back from before the first deploy.
    ...(facts.auditLog ? [`REVOKE UPDATE, DELETE, TRUNCATE ON ${space}.audit_log FROM ${account}`] : []),
    ...(facts.migrations ? [`REVOKE ALL ON ${space}._prisma_migrations FROM ${account}`] : []),
  ];

  await client.query("BEGIN");
  try {
    for (const statement of statements) await client.query(statement);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** The migrations this image carries, oldest first: the folders in prisma/migrations. */
export async function shippedMigrations(folder: string = MIGRATIONS): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The migrations this image carries that have a maintenance note. */
export async function maintenanceMigrations(folder: string = MIGRATIONS): Promise<string[]> {
  const names = await shippedMigrations(folder);
  const noted = await Promise.all(
    names.map((name) =>
      stat(join(folder, name, MAINTENANCE_NOTE)).then(
        () => true,
        () => false,
      ),
    ),
  );
  return names.filter((_, index) => noted[index]);
}

/** The migrations the database has run to the end and not rolled back; none before the first deploy. */
export async function appliedMigrations(client: pg.Client, schema: string): Promise<string[]> {
  const table = `${client.escapeIdentifier(schema)}._prisma_migrations`;
  const found = await client.query<{ present: boolean }>("SELECT to_regclass($1) IS NOT NULL AS present", [table]);
  if (!found.rows[0]?.present) return [];
  const { rows } = await client.query<{ name: string }>(
    `SELECT migration_name AS name FROM ${table} WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  );
  return rows.map((row) => row.name).sort();
}

/** What the image and the database disagree on: migrations still to run, and ones the image doesn't know. */
export function migrationDifference(shipped: string[], applied: string[]): { pending: string[]; unknown: string[] } {
  return {
    pending: shipped.filter((name) => !applied.includes(name)),
    unknown: applied.filter((name) => !shipped.includes(name)),
  };
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not set");
  return value;
}

/** DATABASE_URL without the ?schema= that node-postgres doesn't know, and the schema it names. */
function ownerConnection(): { url: string; schema: string } {
  const url = new URL(databaseUrl());
  const schema = url.searchParams.get("schema") ?? "public";
  url.searchParams.delete("schema");
  return { url: url.toString(), schema };
}

async function withOwner<T>(work: (client: pg.Client, schema: string) => Promise<T>): Promise<T> {
  const { url, schema } = ownerConnection();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client, schema);
  } finally {
    await client.end();
  }
}

const USAGE = `Usage: tsx scripts/tools.ts <command>
  grants                             the app's database account and its rights (APP_DB_PASSWORD)
  pending-migrations [--unknown | --maintenance]
                                     migrations not run yet (or run, but not in this image; or not
                                     run yet, and needing the app stopped)
  create-admin --name "<name>" --mobile <07XXXXXXXX> [--designation "<title>"] [--email <address>] [--another]`;

async function main([command, ...args]: string[]): Promise<number> {
  switch (command) {
    case "grants": {
      const password = process.env.APP_DB_PASSWORD ?? "";
      // The settings' own rule (the Infrastructure repository's README, "Settings").
      if (!/^[A-Za-z0-9_-]{32,}$/.test(password)) {
        console.error("APP_DB_PASSWORD must be at least 32 letters, digits, - or _.");
        return 1;
      }
      await withOwner((client, schema) => applyGrants(client, { role: APP_ROLE, schema, password }));
      console.log(`${APP_ROLE}: rights granted`);
      return 0;
    }
    case "pending-migrations": {
      const applied = await withOwner(appliedMigrations);
      const { pending, unknown } = migrationDifference(await shippedMigrations(), applied);
      let names = pending;
      if (args.includes("--unknown")) names = unknown;
      if (args.includes("--maintenance")) {
        const noted = await maintenanceMigrations();
        names = pending.filter((name) => noted.includes(name));
      }
      for (const name of names) console.log(name);
      return 0;
    }
    case "create-admin": {
      const url = databaseUrl();
      // Loaded only here, so the other commands don't load the app's code.
      const [{ createAdminCommand }, { createPrismaClient }] = await Promise.all([
        import("./create-admin"),
        import("../src/server/db"),
      ]);
      // src/server/db.ts reads the ?schema= itself.
      const prisma = createPrismaClient(url);
      try {
        return await createAdminCommand(prisma, args);
      } finally {
        await prisma.$disconnect();
      }
    }
    default:
      console.error(USAGE);
      return 2;
  }
}

// Run directly: see the top of this file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
