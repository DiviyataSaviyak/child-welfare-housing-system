/**
 * SEC-2: calls every Server Action and route handler as every kind of visitor, and checks that the
 * role check runs first. A visitor who may not use it gets "not found" (PRM-1, ERR-2) or the sign-in
 * page, and nothing but their own session is read from the database before that.
 *
 * The real `requireRole` and `requireSignedIn` run (src/server/context.ts); only the session behind
 * them is made up, and the database refuses anything but that session. Each of the five roles signs in,
 * and a view-only account of each office type. Whether an allowed role then sees only its own area is
 * for the database and end-to-end tests.
 *
 * A new actions.ts or route.ts, or a new export in one, fails this test until it is added to RULES.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Designation, roleOf } from "@/server/auth/designations";
import type { Role } from "@/server/auth/roles";

const state = vi.hoisted(() => ({
  session: null as null | {
    role: string;
    designation: string | null;
    dsOfficeId: number | null;
    districtId: number | null;
    provinceId: number | null;
    mustChangePassword: boolean;
  },
  touched: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// getContext names the account in the screen's language (ADM-10); outside a request that is Sinhala.
vi.mock("next-intl/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl/server")>()),
  getLocale: async () => "si",
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: new Proxy(
      {},
      {
        get: (_target, name) =>
          name === "getSession"
            ? async () => (state.session ? { session: { id: "session-1" }, user: { id: "user-1" } } : null)
            : async () => {
                state.touched.push(`auth.${String(name)}`);
                throw new Error("touched");
              },
      },
    ),
  },
}));
// The database answers only for the session; any other table counts as "touched".
vi.mock("@/server/db", () => {
  const now = () => new Date();
  const session = {
    findUnique: async () =>
      state.session && {
        id: "session-1",
        createdAt: now(),
        lastActiveAt: now(),
        user: {
          id: "user-1",
          name: "පරීක්ෂණ",
          role: state.session.role,
          banned: false,
          designation: state.session.designation,
          dsOfficeId: state.session.dsOfficeId,
          districtId: state.session.districtId,
          provinceId: state.session.provinceId,
          mustChangePassword: state.session.mustChangePassword,
          dsOffice: null,
          district: null,
          province: null,
        },
      },
    update: async () => ({}),
    deleteMany: async () => ({ count: 0 }),
  };
  const touch = (name: string) => {
    state.touched.push(name);
    throw new Error("touched");
  };
  const db: unknown = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === "session") return session;
        if (name === "then") return undefined;
        return new Proxy(() => touch(String(name)), { get: () => () => touch(String(name)) });
      },
    },
  );
  return { db };
});

/** A signed-in account: its designation, which gives the role, and its place. */
type Account = { role: Role; designation: Designation | null; place: Partial<Record<PlaceField, number>> };
type PlaceField = "dsOfficeId" | "districtId" | "provinceId";

const account = (designation: Designation | null, place: Account["place"] = {}): Account => ({
  role: roleOf(designation),
  designation,
  place,
});

const ACCOUNTS = {
  crpo: account("DS_CRPO", { dsOfficeId: 1 }),
  dsAccountant: account("DS_ACCOUNTANT", { dsOfficeId: 1 }),
  districtCrpo: account("DISTRICT_CRPO", { districtId: 1 }),
  districtSecretary: account("DISTRICT_SECRETARY", { districtId: 1 }),
  provincialCommissioner: account("PROVINCE_COMMISSIONER", { provinceId: 1 }),
  departmentCommissioner: account("DEPARTMENT_COMMISSIONER"),
  ministrySecretary: account("MINISTRY_SECRETARY"),
  programmeOfficer: account("MINISTRY_PROGRAMME_OFFICER"),
  chiefAccountant: account("MINISTRY_CHIEF_ACCOUNTANT"),
  admin: account(null),
} satisfies Record<string, Account>;

type Visitor = "signedOut" | "temporaryPassword" | keyof typeof ACCOUNTS;
const VISITORS: Visitor[] = ["signedOut", "temporaryPassword", ...(Object.keys(ACCOUNTS) as (keyof typeof ACCOUNTS)[])];

/** Who may call it. */
type Rule =
  | { role: Role | Role[] } // requireRole: the sign-in page, the password page, or "not found"
  | { signedIn: "temporaryAllowed" } // changing one's own password
  | { signedIn: "own" } // changing one's own details: any role, once the temporary password is changed
  | { signedIn: "file" } // a file: "not found" unless the account sees cases; the case's own check follows
  | { anyone: string }; // open to all, with the reason

const DS: Rule = { role: "DS_OFFICER" };
const MINISTRY: Rule = { role: "MINISTRY_OFFICER" };
const ADMIN: Rule = { role: "ADMIN" };
/** The view-only area (PRM-4, PRM-5): it changes nothing, and only reads within the account's own area. */
const OVERSIGHT: Rule = { role: ["VIEWER", "DISTRICT_OFFICER"] };

const RULES: Record<string, Record<string, Rule>> = {
  "src/app/(auth)/actions.ts": {
    signIn: { anyone: "the sign-in form, behind the rate limit and lockout (SEC-4, AUTH-2)" },
    askForCode: {
      anyone:
        "sends a reset code by email to the account's own address, behind its own rate limits; same answer for any username (AUTH-7)",
    },
    checkCode: { anyone: "checks a reset code against its ticket, with 5 tries per code (AUTH-7)" },
    setNewPassword: { anyone: "sets a password only with a ticket whose emailed code was right (AUTH-7)" },
    changePassword: { signedIn: "temporaryAllowed" },
    signOut: { anyone: "ends only the caller's own session" },
  },
  "src/app/_profile/actions.ts": { updateProfileAction: { signedIn: "own" } },
  "src/i18n/actions.ts": { chooseLanguage: { anyone: "sets the caller's own language cookie (UI-9)" } },
  "src/app/health/route.ts": { GET: { anyone: "says only whether the app reaches its database (OPS-3)" } },
  "src/app/admin/lists/actions.ts": {
    addOfficeAction: ADMIN,
    renameOfficeAction: ADMIN,
    setOfficeActiveAction: ADMIN,
    addStageAction: ADMIN,
    renameStageAction: ADMIN,
    moveStageAction: ADMIN,
    setStageActiveAction: ADMIN,
  },
  "src/app/admin/users/actions.ts": {
    createAccountAction: ADMIN,
    updateAccountAction: ADMIN,
    resetPasswordAction: ADMIN,
    setDisabledAction: ADMIN,
  },
  "src/app/ds/cases/actions.ts": {
    saveCaseAction: DS,
    uploadDocumentAction: DS,
    checkNicAction: DS,
    removeDocumentAction: DS,
    deleteCaseAction: DS,
  },
  "src/app/ds/cases/[id]/actions.ts": {
    startInstallmentAction: DS,
    payInstallmentAction: DS,
    stageUpdateAction: DS,
    uploadPhotoAction: DS,
  },
  "src/app/ds/notifications/actions.ts": { openNotificationAction: DS, markAllReadAction: DS },
  "src/app/ds/export/route.ts": { GET: DS },
  "src/app/ds/notifications/unread/route.ts": { GET: DS },
  "src/app/ministry/cases/actions.ts": {
    saveCaseAction: MINISTRY,
    uploadDocumentAction: MINISTRY,
    checkNicAction: MINISTRY,
    removeDocumentAction: MINISTRY,
    deleteCaseAction: MINISTRY,
  },
  "src/app/ministry/cases/[id]/actions.ts": {
    undoInstallmentAction: MINISTRY,
  },
  "src/app/ministry/allocate/actions.ts": {
    recordLetterAction: MINISTRY,
    uploadLetterScanAction: MINISTRY,
    correctReleaseAction: MINISTRY,
  },
  "src/app/ministry/cases/export/route.ts": { GET: MINISTRY },
  "src/app/ministry/waiting/route.ts": { GET: MINISTRY },
  "src/app/oversight/cases/export/route.ts": { GET: OVERSIGHT },
  "src/app/files/[id]/route.ts": { GET: { signedIn: "file" } },
  "src/app/files/[id]/thumb/route.ts": { GET: { signedIn: "file" } },
};

type Outcome = "signIn" | "changePassword" | "notFound" | "passes";

function expected(rule: Rule, visitor: Visitor): Outcome {
  if ("anyone" in rule) return "passes";
  if ("signedIn" in rule) {
    if (rule.signedIn === "own" && visitor === "temporaryPassword") return "changePassword";
    if (rule.signedIn === "file") {
      if (visitor === "signedOut" || visitor === "temporaryPassword") return "notFound";
      // Every account that sees cases may open their files (PRM-4); the admin sees none (PRM-2).
      return ACCOUNTS[visitor].role === "ADMIN" ? "notFound" : "passes";
    }
    return visitor === "signedOut" ? "signIn" : "passes";
  }
  if (visitor === "signedOut") return "signIn";
  if (visitor === "temporaryPassword") return "changePassword";
  return [rule.role].flat().includes(ACCOUNTS[visitor].role) ? "passes" : "notFound";
}

/** Next's redirect() and notFound() throw errors that carry a digest. */
function outcomeOf(error: unknown): Outcome {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : "";
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "notFound";
  if (digest.startsWith("NEXT_REDIRECT") && digest.includes(";/login")) return "signIn";
  if (digest.startsWith("NEXT_REDIRECT") && digest.includes(";/change-password")) return "changePassword";
  return "passes";
}

async function call(fn: (...args: unknown[]) => unknown, isRoute: boolean): Promise<Outcome> {
  const args = isRoute
    ? [
        new NextRequest("http://localhost/x"),
        { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) },
      ]
    : [{}, new FormData(), new FormData()];
  try {
    await fn(...args);
    return "passes";
  } catch (error) {
    return outcomeOf(error);
  }
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listFiles(path);
    return name === "actions.ts" || name === "route.ts" ? [relative(process.cwd(), path).replaceAll("\\", "/")] : [];
  });
}

const modules = import.meta.glob(["/src/app/**/actions.ts", "/src/app/**/route.ts", "/src/i18n/actions.ts"]);

function load(file: string): Promise<Record<string, unknown>> {
  const loader = modules[`/${file}`];
  if (!loader) throw new Error(`${file} was not found`);
  return loader() as Promise<Record<string, unknown>>;
}

function signInAs(visitor: Visitor) {
  if (visitor === "signedOut") {
    state.session = null;
    return;
  }
  const { role, designation, place } = visitor === "temporaryPassword" ? ACCOUNTS.crpo : ACCOUNTS[visitor];
  state.session = {
    role,
    designation,
    dsOfficeId: place.dsOfficeId ?? null,
    districtId: place.districtId ?? null,
    provinceId: place.provinceId ?? null,
    mustChangePassword: visitor === "temporaryPassword",
  };
}

beforeEach(() => {
  state.session = null;
  state.touched = [];
});

describe("every Server Action and route handler has a rule (SEC-2)", () => {
  const files = [...listFiles("src/app"), "src/i18n/actions.ts"].sort();

  it("lists every actions.ts and route.ts", () => {
    expect(files).toEqual(Object.keys(RULES).sort());
  });

  for (const file of files) {
    it(`lists every export of ${file}`, async () => {
      const exports = await load(file);
      const exported = Object.keys(exports).filter((name) => typeof exports[name] === "function");
      expect(exported.sort()).toEqual(Object.keys(RULES[file] ?? {}).sort());
    }, 60_000); // The first import of the export routes loads ExcelJS.
  }
});

describe("every visitor gets only what their role allows (SEC-2, PRM-1)", () => {
  for (const [file, rules] of Object.entries(RULES)) {
    for (const [name, rule] of Object.entries(rules)) {
      if ("anyone" in rule) continue;
      it(`${file} ${name}`, async () => {
        const fn = (await load(file))[name] as (...args: unknown[]) => unknown;
        for (const visitor of VISITORS) {
          signInAs(visitor);
          state.touched = [];
          const want = expected(rule, visitor);
          const got = await call(fn, file.endsWith("route.ts"));
          expect({ visitor, outcome: got }).toEqual({ visitor, outcome: want });
          if (want !== "passes") expect({ visitor, touched: state.touched }).toEqual({ visitor, touched: [] });
        }
      });
    }
  }
});
