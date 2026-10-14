/**
 * SEC-2: calls every Server Action and route handler as every kind of visitor, and checks that the
 * role check runs first. A visitor who may not use it gets "not found" (PRM-1, ERR-2) or the sign-in
 * page, and nothing but their own session is read from the database before that.
 *
 * The real `requireRole` and `requireSignedIn` run (src/server/context.ts); only the session behind
 * them is made up, and the database refuses anything but that session. Whether an allowed role then
 * sees only its own office is for the database and end-to-end tests.
 *
 * A new actions.ts or route.ts, or a new export in one, fails this test until it is added to RULES.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/server/auth/roles";

const state = vi.hoisted(() => ({
  session: null as null | { role: string; mustChangePassword: boolean },
  touched: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
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
          dsOfficeId: state.session.role === "DS_OFFICER" ? 1 : null,
          mustChangePassword: state.session.mustChangePassword,
          dsOffice: null,
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

type Visitor = "signedOut" | "temporaryPassword" | Role;
const VISITORS: Visitor[] = ["signedOut", "temporaryPassword", "DS_OFFICER", "HO_OFFICER", "ADMIN"];

/** Who may call it. */
type Rule =
  | { role: Role } // requireRole: the sign-in page, the password page, or "not found"
  | { signedIn: "temporaryAllowed" } // changing one's own password
  | { signedIn: "file" } // a file: "not found" unless a DS or Head Office officer; the case's own check follows
  | { anyone: string }; // open to all, with the reason

const DS: Rule = { role: "DS_OFFICER" };
const HO: Rule = { role: "HO_OFFICER" };
const ADMIN: Rule = { role: "ADMIN" };

const RULES: Record<string, Record<string, Rule>> = {
  "src/app/(auth)/actions.ts": {
    signIn: { anyone: "the sign-in form, behind the rate limit and lockout (SEC-4, AUTH-2)" },
    askForPassword: {
      anyone: "asks the admin for a new password, behind its own rate limit; says the same for any username (AUTH-7)",
    },
    changePassword: { signedIn: "temporaryAllowed" },
    signOut: { anyone: "ends only the caller's own session" },
  },
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
    closeRequestAction: ADMIN,
    setDisabledAction: ADMIN,
  },
  "src/app/admin/waiting/route.ts": { GET: ADMIN },
  "src/app/ds/cases/actions.ts": {
    saveCaseAction: DS,
    uploadDocumentAction: DS,
    checkNicAction: DS,
    removeDocumentAction: DS,
    deleteDraftAction: DS,
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
  "src/app/ho/cases/actions.ts": {
    saveCaseAction: HO,
    uploadDocumentAction: HO,
    checkNicAction: HO,
    removeDocumentAction: HO,
    deleteDraftAction: HO,
  },
  "src/app/ho/cases/[id]/actions.ts": { stopAction: HO, reopenAction: HO, undoInstallmentAction: HO },
  "src/app/ho/check/actions.ts": {
    decideAction: HO,
    recordLetterAction: HO,
    uploadLetterScanAction: HO,
    correctReleaseAction: HO,
  },
  "src/app/ho/cases/export/route.ts": { GET: HO },
  "src/app/ho/waiting/route.ts": { GET: HO },
  "src/app/files/[id]/route.ts": { GET: { signedIn: "file" } },
  "src/app/files/[id]/thumb/route.ts": { GET: { signedIn: "file" } },
};

type Outcome = "signIn" | "changePassword" | "notFound" | "passes";

function expected(rule: Rule, visitor: Visitor): Outcome {
  if ("anyone" in rule) return "passes";
  if ("signedIn" in rule) {
    // The admin sees no cases (PRM-1), so no files either.
    if (rule.signedIn === "file") return visitor === "DS_OFFICER" || visitor === "HO_OFFICER" ? "passes" : "notFound";
    return visitor === "signedOut" ? "signIn" : "passes";
  }
  if (visitor === "signedOut") return "signIn";
  if (visitor === "temporaryPassword") return "changePassword";
  return visitor === rule.role ? "passes" : "notFound";
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
  state.session =
    visitor === "signedOut"
      ? null
      : visitor === "temporaryPassword"
        ? { role: "DS_OFFICER", mustChangePassword: true }
        : { role: visitor, mustChangePassword: false };
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
