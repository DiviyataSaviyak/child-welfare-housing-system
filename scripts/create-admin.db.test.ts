import { verifyPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../prisma/seed-data";
import { createTestClient } from "../tests/db/client";
import { createAdmin } from "./create-admin";

const db = createTestClient();
const details = { name: "පළමු පරිපාලක", mobile: "0710000901", designation: "සහකාර ලේකම්" };

beforeAll(() => seed(db));
afterAll(() => db.$disconnect());

describe("the first admin account (task 9.5)", () => {
  it("makes an admin with a temporary password, credited to the system", async () => {
    // Other test files share the schema and may have added an admin already.
    const result = await createAdmin(db, details, { another: true });
    if (!result.ok) throw new Error(result.error);

    const { username, temporaryPassword } = result.credentials;
    expect(username).toMatch(/^ad\d{4}$/);
    const user = await db.user.findUniqueOrThrow({ where: { username } });
    expect(user).toMatchObject({ role: "ADMIN", dsOfficeId: null, banned: false, mustChangePassword: true });

    const account = await db.account.findFirstOrThrow({ where: { userId: user.id, providerId: "credential" } });
    expect(await verifyPassword({ hash: account.password ?? "", password: temporaryPassword })).toBe(true);
    expect(account.password).not.toContain(temporaryPassword);

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: user.id, action: "account_created" } });
    expect(audit.actorId).toBeNull();
  });

  it("refuses while an active admin exists, unless asked for another", async () => {
    expect(await createAdmin(db, details)).toEqual({ ok: false, error: "adminExists" });
  });

  it("refuses details the account form would refuse", async () => {
    const result = await createAdmin(db, { ...details, mobile: "12" }, { another: true });
    expect(result).toMatchObject({ ok: false, error: "invalid" });
  });
});
