import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { asSubmittedV1, createTestClient, freeOfficeId, testApplicationNumber } from "../../../tests/db/client";
import type { CaseValues } from "@/lib/validation/case";
import { type Actor, saveCase, type SaveCaseInput } from "./commands";
import { decideCase } from "./decide";
import { openRequests } from "./replacements";
import { reopenCase, stopCase } from "./stop";

/**
 * CASE-11: replacing a beneficiary by a new case linked to the one Head Office rejected or stopped. Change
 * 0006 removes it: task 4 took the form's question and the to-do item; task 5 removes the rest, and this
 * file with it. Change 0008's amendments take its place.
 */

const db = createTestClient();

let dsA: Actor;
let dsB: Actor;
let ho: Actor;

/** A complete, made-up case (SEC-11). Each test gives its own NIC so tests don't match each other. */
const values = (nic: string, overrides: Partial<CaseValues> = {}): CaseValues => ({
  category: "CARE_LEAVER",
  kind: "NEW_HOUSE",
  applicationNumber: testApplicationNumber(),
  childName: null,
  name: "ප්‍රතිස්ථාපන පරීක්ෂණ",
  nic,
  address: "නො. 2, පරීක්ෂණ පාර",
  gnDivision: null,
  mobile1: "0710000002",
  mobile2: null,
  remark: null,
  ...overrides,
});

const input = (nic: string, overrides: Partial<SaveCaseInput> = {}): SaveCaseInput => ({
  id: randomUUID(),
  version: null,
  dsOfficeId: null,
  buildDsOfficeId: null,
  values: values(nic),
  documentIds: [],
  ...overrides,
});

const load = (id: string) => db.case.findUniqueOrThrow({ where: { id } });

async function submitted(nic: string, actor = dsA) {
  const result = await saveCase(db, actor, input(nic));
  if (!result.ok) throw new Error(result.error);
  await asSubmittedV1(db, result.value.id, actor.userId);
  return load(result.value.id);
}

/** A submitted case Head Office rejects, asking for another name unless told not to. */
async function rejected(nic: string, askAnotherName = true, actor = dsA) {
  const sent = await submitted(nic, actor);
  const result = await decideCase(db, ho, {
    caseId: sent.id,
    version: sent.version,
    decision: "reject",
    reason: "පවුලට දැනටමත් නිවසක් ඇත.",
    askAnotherName,
  });
  if (!result.ok) throw new Error(result.error);
  return load(sent.id);
}

async function verified(nic: string) {
  const sent = await submitted(nic);
  const result = await decideCase(db, ho, { caseId: sent.id, version: sent.version, decision: "verify", reason: null });
  if (!result.ok) throw new Error(result.error);
  return load(sent.id);
}

async function officer(id: string): Promise<Actor> {
  const dsOfficeId = await freeOfficeId(db);
  await db.user.create({
    data: {
      id,
      name: "ප්‍ර. පරීක්ෂණ",
      email: `${id}@no-email.invalid`,
      role: "DS_OFFICER",
      designation: "DS_CRPO",
      dsOfficeId,
    },
  });
  return { userId: id, role: "DS_OFFICER", designation: "DS_CRPO", districtId: null, provinceId: null, dsOfficeId };
}

beforeAll(async () => {
  await seed(db);
  dsA = await officer("replace-test-ds-a");
  dsB = await officer("replace-test-ds-b");
  await db.user.create({
    data: {
      id: "replace-test-ho",
      name: "ප්‍ර. පරීක්ෂණ",
      email: "replace-test-ho@no-email.invalid",
      role: "MINISTRY_OFFICER",
      designation: "MINISTRY_PROGRAMME_OFFICER",
    },
  });
  ho = {
    userId: "replace-test-ho",
    role: "MINISTRY_OFFICER",
    designation: "MINISTRY_PROGRAMME_OFFICER",
    districtId: null,
    provinceId: null,
    dsOfficeId: null,
  };
});

afterAll(async () => {
  await db.$disconnect();
});

describe("asking for another name (CHK-3, CLS-2)", () => {
  it("marks a rejected case only when Head Office ticks the box, and logs it", async () => {
    const asked = await rejected("201112000001");
    const plain = await rejected("201112000002", false);
    expect(asked.status).toBe("REJECTED");
    expect(asked.anotherNameRequested).toBe(true);
    expect(plain.anotherNameRequested).toBe(false);

    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: asked.id, action: "case_rejected" } });
    expect(audit.after).toMatchObject({ status: "REJECTED", anotherNameRequested: true });
  });

  it("keeps the request to the office's own officers and the Ministry", async () => {
    const asked = await rejected("201112000003");
    expect((await openRequests(db, dsA)).some((r) => r.id === asked.id)).toBe(true);
    expect((await openRequests(db, dsB)).some((r) => r.id === asked.id)).toBe(false);
    expect((await openRequests(db, ho)).some((r) => r.id === asked.id)).toBe(true);
  });

  it("marks a stopped case too, and reopening withdraws the request", async () => {
    const running = await verified("201112000004");
    const stopped = await stopCase(db, ho, {
      caseId: running.id,
      version: running.version,
      reason: "ප්‍රතිලාභියා විදේශගත විය.",
      askAnotherName: true,
    });
    expect(stopped).toEqual({ ok: true, value: "STOPPED" });
    const afterStop = await load(running.id);
    expect(afterStop.anotherNameRequested).toBe(true);

    const reopened = await reopenCase(db, ho, {
      caseId: running.id,
      version: afterStop.version,
      reason: "ප්‍රතිලාභියා ආපසු පැමිණියා.",
    });
    expect(reopened).toEqual({ ok: true, value: "VERIFIED" });
    expect((await load(running.id)).anotherNameRequested).toBe(false);
    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: running.id, action: "case_reopened" } });
    expect(audit.after).toMatchObject({ anotherNameWithdrawn: true });
  });
});

describe("a case entered in another's place (CASE-11)", () => {
  it("refuses to reopen a stopped case once another has taken its place (CLS-3)", async () => {
    const running = await verified("201112000061");
    await stopCase(db, ho, {
      caseId: running.id,
      version: running.version,
      reason: "කරගෙන යා නොහැක.",
      askAnotherName: true,
    });
    // The form no longer asks (change 0006); a link made before stays, as here.
    const replacement = await saveCase(db, dsA, input("201112000062"));
    if (!replacement.ok) throw new Error(replacement.error);
    await db.case.update({ where: { id: replacement.value.id }, data: { replacesCaseId: running.id } });

    const current = await load(running.id);
    expect(
      await reopenCase(db, ho, { caseId: running.id, version: current.version, reason: "නැවත ආරම්භ කරමු." }),
    ).toEqual({ ok: false, error: "replaced" });
    expect((await load(running.id)).status).toBe("STOPPED");
  });

  it("can't mark a running case, or link a case to itself, even when written directly to the database", async () => {
    const running = await verified("201112000071");
    await expect(db.case.update({ where: { id: running.id }, data: { anotherNameRequested: true } })).rejects.toThrow();
    await expect(db.case.update({ where: { id: running.id }, data: { replacesCaseId: running.id } })).rejects.toThrow();
  });
});
