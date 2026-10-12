import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { createTestClient, freeOfficeId } from "../../../tests/db/client";
import type { CaseValues } from "@/lib/validation/case";
import { type Actor, saveCase, type SaveCaseInput } from "./commands";
import { decideCase } from "./decide";
import { getCase, todoItems } from "./queries";
import { listQueue } from "./queues";
import { openRequests } from "./replacements";
import { reopenCase, stopCase } from "./stop";

/** CASE-11: replacing a beneficiary by a new case linked to the one Head Office rejected or stopped. */

const db = createTestClient();

let dsA: Actor;
let dsB: Actor;
let ho: Actor;

/** A complete, made-up case (SEC-11). Each test gives its own NIC so tests don't match each other. */
const values = (nic: string, overrides: Partial<CaseValues> = {}): CaseValues => ({
  category: "CARE_LEAVER",
  kind: "NEW_HOUSE",
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
  values: values(nic),
  documentIds: [],
  submit: false,
  ...overrides,
});

const load = (id: string) => db.case.findUniqueOrThrow({ where: { id } });

async function submitted(nic: string, actor = dsA) {
  const result = await saveCase(db, actor, input(nic, { submit: true }));
  if (!result.ok) throw new Error(result.error);
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
    data: { id, name: "ප්‍ර. පරීක්ෂණ", email: `${id}@no-email.invalid`, role: "DS_OFFICER", dsOfficeId },
  });
  return { userId: id, role: "DS_OFFICER", dsOfficeId };
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
      role: "HO_OFFICER",
    },
  });
  ho = { userId: "replace-test-ho", role: "HO_OFFICER", dsOfficeId: null };
});

afterAll(async () => {
  await db.$disconnect();
});

describe("asking for another name (CHK-3, CLS-2, HOME-3)", () => {
  it("marks a rejected case only when Head Office ticks the box, and logs it", async () => {
    const asked = await rejected("201112000001");
    const plain = await rejected("201112000002", false);
    expect(asked.status).toBe("REJECTED");
    expect(asked.anotherNameRequested).toBe(true);
    expect(plain.anotherNameRequested).toBe(false);

    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: asked.id, action: "case_rejected" } });
    expect(audit.after).toMatchObject({ status: "REJECTED", anotherNameRequested: true });
  });

  it("puts the request first on the office's to-do list, with Head Office's reason, and nowhere else", async () => {
    const asked = await rejected("201112000003");
    const todo = await todoItems(db, dsA);
    const item = todo.find((i) => i.id === asked.id);
    expect(item).toMatchObject({ type: "replace", caseNumber: asked.caseNumber, reason: "පවුලට දැනටමත් නිවසක් ඇත." });
    expect(todo[0]?.type).toBe("replace");

    expect((await todoItems(db, dsB)).some((i) => i.id === asked.id)).toBe(false);
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

describe("entering a case in another's place (CASE-11, AC-30)", () => {
  it("links the new case, takes the request off the list, and shows the link on both cases", async () => {
    const old = await rejected("201112000011");
    const saved = await saveCase(db, dsA, input("201112000012", { submit: true, replaces: old.id }));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const fresh = await load(saved.value.id);
    expect(fresh.replacesCaseId).toBe(old.id);
    // The old case is claimed with its version moved on, so a reopening at the same time is refused.
    expect((await load(old.id)).version).toBe(old.version + 1);
    expect((await todoItems(db, dsA)).some((i) => i.id === old.id)).toBe(false);
    expect((await openRequests(db, dsA)).some((r) => r.id === old.id)).toBe(false);
    // Its own form still offers the case it replaces.
    expect((await openRequests(db, dsA, { forCaseId: fresh.id })).some((r) => r.id === old.id)).toBe(true);

    const newPage = await getCase(db, dsA, fresh.id, "si");
    expect(newPage?.replaces).toMatchObject({
      id: old.id,
      caseNumber: old.caseNumber,
      status: "REJECTED",
      reason: "පවුලට දැනටමත් නිවසක් ඇත.",
    });
    const queue = await listQueue(db, ho, "check", 1, "si", { dsOfficeId: dsA.dsOfficeId ?? undefined });
    expect(queue.rows.find((row) => row.id === fresh.id)?.replacesNumber).toBe(old.caseNumber);

    const oldPage = await getCase(db, ho, old.id, "si");
    expect(oldPage?.anotherNameRequested).toBe(true);
    expect(oldPage?.replacedBy).toMatchObject({ id: fresh.id, caseNumber: fresh.caseNumber });

    const created = await db.auditLog.findFirstOrThrow({ where: { caseId: fresh.id, action: "case_created" } });
    expect(created.after).toMatchObject({ replacesCaseId: old.id });
  });

  it("needs an answer to submit when the form asked, but not to save a draft", async () => {
    await rejected("201112000021");
    const unanswered = input("201112000022", { submit: true, replaces: "" });
    expect(await saveCase(db, dsA, unanswered)).toEqual({ ok: false, error: "replacementRequired" });
    expect(await db.case.findUnique({ where: { id: unanswered.id } })).toBeNull();

    const draft = await saveCase(db, dsA, { ...unanswered, submit: false });
    expect(draft.ok).toBe(true);
    expect((await load(unanswered.id)).replacesCaseId).toBeNull();

    const no = await saveCase(db, dsA, input("201112000023", { submit: true, replaces: null }));
    expect(no.ok).toBe(true);
  });

  it("lets each case be replaced once, only by its own office, and only while it waits", async () => {
    const old = await rejected("201112000031");
    const first = await saveCase(db, dsA, input("201112000032", { replaces: old.id }));
    expect(first.ok).toBe(true);

    expect(await saveCase(db, dsA, input("201112000033", { replaces: old.id }))).toEqual({
      ok: false,
      error: "replacementUnavailable",
    });
    const elsewhere = await rejected("201112000034", true, dsB);
    expect(await saveCase(db, dsA, input("201112000035", { replaces: elsewhere.id }))).toEqual({
      ok: false,
      error: "replacementUnavailable",
    });
    // Head Office entering a case for office A can't link office B's case either.
    expect(
      await saveCase(db, ho, input("201112000036", { dsOfficeId: dsA.dsOfficeId, replaces: elsewhere.id })),
    ).toEqual({ ok: false, error: "replacementUnavailable" });
    const notAsked = await rejected("201112000037", false);
    expect(await saveCase(db, dsA, input("201112000038", { replaces: notAsked.id }))).toEqual({
      ok: false,
      error: "replacementUnavailable",
    });
  });

  it("lets a draft drop its link, which opens the request again", async () => {
    const old = await rejected("201112000041");
    const draft = input("201112000042", { replaces: old.id });
    expect((await saveCase(db, dsA, draft)).ok).toBe(true);
    const saved = await load(draft.id);

    const dropped = await saveCase(db, dsA, { ...draft, version: saved.version, replaces: null });
    expect(dropped.ok).toBe(true);
    expect((await load(draft.id)).replacesCaseId).toBeNull();
    expect((await openRequests(db, dsA)).some((r) => r.id === old.id)).toBe(true);

    const updated = await db.auditLog.findFirstOrThrow({ where: { caseId: draft.id, action: "case_updated" } });
    expect(updated.before).toMatchObject({ replacesCaseId: old.id });
    expect(updated.after).toMatchObject({ replacesCaseId: null });
  });

  it("keeps a verified case's link, whatever the form sends", async () => {
    const old = await rejected("201112000051");
    const sent = await saveCase(db, dsA, input("201112000052", { submit: true, replaces: old.id }));
    if (!sent.ok) throw new Error(sent.error);
    const checked = await load(sent.value.id);
    const verify = await decideCase(db, ho, {
      caseId: checked.id,
      version: checked.version,
      decision: "verify",
      reason: null,
    });
    expect(verify.ok).toBe(true);

    const change = await saveCase(db, ho, {
      ...input("201112000052", { id: checked.id }),
      version: (await load(checked.id)).version,
      replaces: null,
    });
    expect(change.ok).toBe(true);
    expect((await load(checked.id)).replacesCaseId).toBe(old.id);
  });

  it("refuses to reopen a stopped case once another has taken its place (CLS-3)", async () => {
    const running = await verified("201112000061");
    await stopCase(db, ho, {
      caseId: running.id,
      version: running.version,
      reason: "කරගෙන යා නොහැක.",
      askAnotherName: true,
    });
    const stopped = await load(running.id);
    const replacement = await saveCase(db, dsA, input("201112000062", { replaces: running.id }));
    expect(replacement.ok).toBe(true);

    const current = await load(running.id);
    expect(
      await reopenCase(db, ho, { caseId: running.id, version: current.version, reason: "නැවත ආරම්භ කරමු." }),
    ).toEqual({ ok: false, error: "replaced" });
    // A page opened before the link was made is refused too: the link moved the case's version on.
    expect(current.version).toBe(stopped.version + 1);
    expect((await load(running.id)).status).toBe("STOPPED");
  });

  it("can't mark a running case, or link a case to itself, even when written directly to the database", async () => {
    const running = await verified("201112000071");
    await expect(db.case.update({ where: { id: running.id }, data: { anotherNameRequested: true } })).rejects.toThrow();
    await expect(db.case.update({ where: { id: running.id }, data: { replacesCaseId: running.id } })).rejects.toThrow();
  });
});
