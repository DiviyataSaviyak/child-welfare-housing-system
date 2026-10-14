import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { createTestClient, freeOfficeId } from "../../../tests/db/client";
import { colomboDay, dayToDate } from "@/lib/dates";
import type { CaseValues } from "@/lib/validation/case";
import { defaultValidUntil, type ReleaseField } from "@/lib/validation/release";
import { fileForViewer, uploadLetterScan } from "../files/uploads";
import { listNotifications, unreadCount, unreadNow } from "../notifications/queries";
import { openNotification } from "../notifications/commands";
import { correctRelease, type LetterInput, recordLetter } from "../releases/commands";
import { casesForLetter, districtsWaiting, getLetter, recentLetters } from "../releases/queries";
import { type Actor, saveCase, type SaveCaseInput } from "./commands";
import { decideCase } from "./decide";
import { getCase, todoItems } from "./queries";
import { listQueue, queueByOffice, queueCounts, waitingNow } from "./queues";

const db = createTestClient();

let dsA: Actor;
let dsB: Actor;
let ho: Actor;
const admin: Actor = { userId: "review-test-admin", role: "ADMIN", dsOfficeId: null };

/** A complete, made-up case (SEC-11). Each test gives its own NIC so tests don't match each other. */
const values = (nic: string, overrides: Partial<CaseValues> = {}): CaseValues => ({
  category: "CARE_LEAVER",
  kind: "NEW_HOUSE",
  childName: null,
  name: "පරීක්ෂණ ප්‍රතිලාභී",
  nic,
  address: "නො. 1, පරීක්ෂණ පාර",
  gnDivision: null,
  mobile1: "0710000001",
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

/** A case the office has sent to Head Office. */
async function submitted(nic: string, actor = dsA) {
  const result = await saveCase(db, actor, input(nic, { submit: true }));
  if (!result.ok) throw new Error(result.error);
  return load(result.value.id);
}

async function verified(nic: string) {
  const sent = await submitted(nic);
  const result = await decideCase(db, ho, { caseId: sent.id, version: sent.version, decision: "verify", reason: null });
  if (!result.ok) throw new Error(result.error);
  return load(sent.id);
}

const today = () => colomboDay(new Date());
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => colomboDay(new Date(Date.now() - n * DAY));
const letterForm = (overrides: Partial<Record<ReleaseField, string>> = {}): Record<ReleaseField, string> => ({
  letterNumber: "MWCA/3/8/16/01-2026",
  letterDate: today(),
  validUntil: defaultValidUntil(today()),
  note: "",
  ...overrides,
});

const districtOf = async (dsOfficeId: number) =>
  (await db.dsOffice.findUniqueOrThrow({ where: { id: dsOfficeId }, select: { districtId: true } })).districtId;

type Ticked = { id: string; version: number; dsOfficeId: number };

/** A letter for these cases of one district, as the form sends it. */
async function letter(cases: Ticked[], overrides: Partial<Record<ReleaseField, string>> = {}): Promise<LetterInput> {
  return {
    districtId: await districtOf(cases[0].dsOfficeId),
    cases: cases.map((c) => ({ id: c.id, version: c.version })),
    form: letterForm(overrides),
    scanId: null,
  };
}

/** Verified, then released together on one letter. */
async function released(...nics: string[]) {
  const ready = [];
  for (const nic of nics) ready.push(await verified(nic));
  const result = await recordLetter(db, ho, await letter(ready));
  if (!result.ok) throw new Error(String(result.error ?? JSON.stringify(result.errors)));
  return Promise.all(ready.map((c) => load(c.id)));
}

async function officer(id: string): Promise<Actor> {
  const dsOfficeId = await freeOfficeId(db);
  await db.user.create({
    data: { id, name: "ප. පරීක්ෂණ", email: `${id}@no-email.invalid`, role: "DS_OFFICER", dsOfficeId },
  });
  return { userId: id, role: "DS_OFFICER", dsOfficeId };
}

beforeAll(async () => {
  await seed(db);
  dsA = await officer("review-test-ds-a");
  dsB = await officer("review-test-ds-b");
  await db.user.create({
    data: { id: "review-test-ho", name: "ප්‍ර. පරීක්ෂණ", email: "review-test-ho@no-email.invalid", role: "HO_OFFICER" },
  });
  ho = { userId: "review-test-ho", role: "HO_OFFICER", dsOfficeId: null };
  await db.user.create({
    data: { id: admin.userId, name: "පරිපාලක", email: "review-test-admin@no-email.invalid", role: "ADMIN" },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("checking a case (CHK-3)", () => {
  it("verifies it, records the decision and tells the office's officer", async () => {
    const sent = await submitted("200200000001");
    const result = await decideCase(db, ho, {
      caseId: sent.id,
      version: sent.version,
      decision: "verify",
      reason: null,
    });

    expect(result).toEqual({ ok: true, value: "VERIFIED" });
    const after = await load(sent.id);
    expect(after.status).toBe("VERIFIED");
    expect(after.verifiedAt).not.toBeNull();
    expect(await db.decision.count({ where: { caseId: sent.id, type: "VERIFY", byId: ho.userId } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: sent.id, action: "case_verified" } });
    expect(audit).toMatchObject({ actorId: ho.userId, before: { status: "SUBMITTED" }, after: { status: "VERIFIED" } });
    const notices = await db.notification.findMany({ where: { caseId: sent.id } });
    expect(notices.map((n) => [n.userId, n.type])).toEqual([[dsA.userId, "VERIFIED"]]);
  });

  it("needs a reason of 5 to 1,000 characters to send back or reject, and shows it to the office (AC-9)", async () => {
    const sent = await submitted("200200000002");
    const decide = (decision: "sendBack" | "reject", reason: string | null) =>
      decideCase(db, ho, { caseId: sent.id, version: sent.version, decision, reason });

    expect(await decide("sendBack", null)).toEqual({ ok: false, error: "reasonRequired" });
    expect(await decide("sendBack", "  ")).toEqual({ ok: false, error: "reasonRequired" });
    expect(await decide("reject", "නැත")).toEqual({ ok: false, error: "reasonTooShort" });
    expect(await decide("reject", "x".repeat(1001))).toEqual({ ok: false, error: "reasonTooLong" });
    expect((await load(sent.id)).status).toBe("SUBMITTED");

    expect(await decide("sendBack", " ලිපිනය සම්පූර්ණ නැත. ")).toEqual({ ok: true, value: "RETURNED" });
    expect((await getCase(db, dsA, sent.id, "si"))?.returnReason).toBe("ලිපිනය සම්පූර්ණ නැත.");
    const todo = await todoItems(db, dsA);
    expect(todo.find((item) => item.id === sent.id)).toMatchObject({
      type: "returned",
      reason: "ලිපිනය සම්පූර්ණ නැත.",
    });
    expect(await db.notification.count({ where: { caseId: sent.id, userId: dsA.userId, type: "SENT_BACK" } })).toBe(1);
  });

  it("puts a resubmitted case back in the queue, with its number, behind older ones (AC-8, AC-9)", async () => {
    const first = await submitted("200200000003");
    const second = await submitted("200200000004");
    await decideCase(db, ho, {
      caseId: first.id,
      version: first.version,
      decision: "sendBack",
      reason: "ඡායාරූප නැත.",
    });
    const returned = await load(first.id);

    const again = await saveCase(db, dsA, {
      ...input("200200000003"),
      id: first.id,
      version: returned.version,
      submit: true,
    });
    expect(again).toMatchObject({ ok: true, value: { status: "SUBMITTED", caseNumber: first.caseNumber } });

    const queue = (await listQueue(db, ho, "check", 1, "si")).rows.map((row) => row.id);
    expect(queue.indexOf(second.id)).toBeGreaterThanOrEqual(0);
    expect(queue.indexOf(first.id)).toBeGreaterThan(queue.indexOf(second.id));
  });

  it("rejects for good (STS-2)", async () => {
    const sent = await submitted("200200000005");
    await decideCase(db, ho, {
      caseId: sent.id,
      version: sent.version,
      decision: "reject",
      reason: "වෙනත් ආධාර ලැබී ඇත.",
    });
    const rejected = await load(sent.id);

    expect(rejected.status).toBe("REJECTED");
    expect((await getCase(db, dsA, sent.id, "si"))?.rejectReason).toBe("වෙනත් ආධාර ලැබී ඇත.");
    expect(await db.notification.count({ where: { caseId: sent.id, userId: dsA.userId, type: "REJECTED" } })).toBe(1);
    expect(
      await decideCase(db, ho, { caseId: sent.id, version: rejected.version, decision: "verify", reason: null }),
    ).toEqual({ ok: false, error: "notAllowedNow" });
    expect(
      await saveCase(db, dsA, { ...input("200200000005"), id: sent.id, version: rejected.version, submit: true }),
    ).toEqual({ ok: false, error: "notEditable" });
  });

  it("lets only Head Office decide, and only a submitted case (STS-1, SEC-2)", async () => {
    const sent = await submitted("200200000006");
    const verify = (actor: Actor, caseId = sent.id, version = sent.version) =>
      decideCase(db, actor, { caseId, version, decision: "verify", reason: null });

    expect(await verify(dsA)).toEqual({ ok: false, error: "roleNotAllowed" });
    expect(await verify(dsB)).toEqual({ ok: false, error: "notFound" });
    expect(await verify(admin)).toEqual({ ok: false, error: "notFound" });
    expect(await verify(ho, randomUUID())).toEqual({ ok: false, error: "notFound" });

    const draft = await saveCase(db, dsA, input("200200000007"));
    if (!draft.ok) throw new Error(draft.error);
    expect(await verify(ho, draft.value.id, 1)).toEqual({ ok: false, error: "notAllowedNow" });
    expect(await db.decision.count({ where: { caseId: sent.id, type: "VERIFY" } })).toBe(0);
  });

  it("doesn't decide on details nobody has seen: the case came back changed (CASE-10)", async () => {
    const sent = await submitted("200200000008");
    await decideCase(db, ho, {
      caseId: sent.id,
      version: sent.version,
      decision: "sendBack",
      reason: "ලිපිනය වැරදියි.",
    });
    const returned = await load(sent.id);
    await saveCase(db, dsA, {
      ...input("200200000008"),
      id: sent.id,
      version: returned.version,
      values: values("200200000008", { address: "නො. 2, නිවැරදි පාර" }),
      submit: true,
    });

    // The check view was opened before it was sent back: its version is old.
    const stale = await decideCase(db, ho, {
      caseId: sent.id,
      version: sent.version,
      decision: "verify",
      reason: null,
    });
    expect(stale).toEqual({ ok: false, error: "conflict" });
  });

  it("lets only one of two officers verifying at the same moment succeed", async () => {
    const sent = await submitted("200200000009");
    const results = await Promise.all(
      [1, 2].map(() =>
        decideCase(db, ho, { caseId: sent.id, version: sent.version, decision: "verify", reason: null }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.decision.count({ where: { caseId: sent.id, type: "VERIFY" } })).toBe(1);
    expect(await db.notification.count({ where: { caseId: sent.id } })).toBe(1);
  });

  it("tells every active officer of the office, and only them (ADM-3)", async () => {
    const office = dsA.dsOfficeId as number;
    const colleague = (id: string, name: string, banned: boolean) =>
      db.user.create({
        data: { id, name, email: `${id}@no-email.invalid`, role: "DS_OFFICER", dsOfficeId: office, banned },
      });
    await colleague("review-test-ds-old", "පැරණි නිලධාරී", true);
    await colleague("review-test-ds-a2", "දෙවන නිලධාරී", false);
    const sent = await submitted("200200000010");
    await decideCase(db, ho, { caseId: sent.id, version: sent.version, decision: "verify", reason: null });
    const told = await db.notification.findMany({ where: { caseId: sent.id }, select: { userId: true } });
    expect(told.map((n) => n.userId).sort()).toEqual([dsA.userId, "review-test-ds-a2"].sort());
    // The later tests count the office's notices as dsA's alone.
    await db.user.update({ where: { id: "review-test-ds-a2" }, data: { banned: true } });
  });
});

describe("the queues (CHK-1, REL-1)", () => {
  it("lists submitted cases oldest first, flagging a NIC that another case has", async () => {
    const older = await submitted("200200000020");
    const twin = await submitted("200200000021");
    await saveCase(db, dsB, input("200200000021", { submit: true }));
    const { rows } = await listQueue(db, ho, "check", 1, "si");

    const ids = rows.map((row) => row.id);
    expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(twin.id));
    const since = rows.map((row) => row.waitingSince?.getTime() ?? 0);
    expect(since).toEqual([...since].sort((a, b) => a - b));
    expect(rows.find((row) => row.id === older.id)?.duplicate).toBe(false);
    expect(rows.find((row) => row.id === twin.id)?.duplicate).toBe(true);
  });

  it("lists verified cases oldest verification first", async () => {
    const first = await verified("200200000022");
    const second = await verified("200200000023");
    const ids = (await listQueue(db, ho, "release", 1, "si")).rows.map((row) => row.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
  });

  it("narrows a queue to a district or one DS office, and counts each office's cases (CHK-4)", async () => {
    const atA = await submitted("200200000024");
    const atB = await submitted("200200000025", dsB);
    const officeA = dsA.dsOfficeId ?? 0;
    const { districtId } = await db.dsOffice.findUniqueOrThrow({
      where: { id: officeA },
      select: { districtId: true },
    });

    const office = await listQueue(db, ho, "check", 1, "si", { districtId, dsOfficeId: officeA });
    expect(office.rows.map((row) => row.id)).toContain(atA.id);
    expect(office.rows.map((row) => row.id)).not.toContain(atB.id);
    expect(office.total).toBe(await db.case.count({ where: { status: "SUBMITTED", dsOfficeId: officeA } }));

    const district = await listQueue(db, ho, "check", 1, "si", { districtId });
    expect(district.total).toBe(await db.case.count({ where: { status: "SUBMITTED", dsOffice: { districtId } } }));
    expect(district.rows.map((row) => row.id)).toContain(atA.id);

    // An office in another district finds nothing there.
    const elsewhere = await db.dsOffice.findFirstOrThrow({ where: { districtId: { not: districtId } } });
    expect((await listQueue(db, ho, "check", 1, "si", { districtId, dsOfficeId: elsewhere.id })).total).toBe(0);

    const counts = await queueByOffice(db, ho, "check");
    expect(counts.get(officeA)).toBe(office.total);
    expect([...counts.values()].reduce((sum, n) => sum + n, 0)).toBe((await queueCounts(db, ho)).check);
    for (const actor of [dsA, admin]) {
      expect((await queueByOffice(db, actor, "check")).size).toBe(0);
      expect((await listQueue(db, actor, "check", 1, "si", { districtId })).total).toBe(0);
    }
  });

  it("counts both queues for Head Office only", async () => {
    const before = Date.now();
    const counts = await queueCounts(db, ho);
    expect(counts.check).toBe(await db.case.count({ where: { status: "SUBMITTED" } }));
    expect(counts.release).toBe(await db.case.count({ where: { status: "VERIFIED" } }));
    // The menu's reading: both together, and when they were read (NTF-1).
    const menu = await waitingNow(db, ho);
    expect(menu.count).toBe(counts.check + counts.release);
    expect(menu.at).toBeGreaterThanOrEqual(before);
    for (const actor of [dsA, admin]) {
      expect(await queueCounts(db, actor)).toEqual({ check: 0, release: 0 });
      expect((await waitingNow(db, actor)).count).toBe(0);
      expect(await listQueue(db, actor, "check", 1, "si")).toEqual({ rows: [], total: 0 });
    }
  });
});

describe("releasing by allocation letter (REL-1 to REL-3, AC-10)", () => {
  it("releases every case ticked on the district's letter: four installments each, and each office told", async () => {
    const first = await verified("200200000030");
    const second = await verified("200200000035");
    const left = await verified("200200000036");
    const input = await letter([first, second], { letterNumber: " MWCA/3/8/16/02-2026 ", note: "පළමු ලිපිය" });
    const result = await recordLetter(db, ho, input);

    expect(result).toMatchObject({ ok: true });
    const letterId = result.ok ? result.letterId : "";
    expect(await db.releaseLetter.findUniqueOrThrow({ where: { id: letterId } })).toMatchObject({
      districtId: input.districtId,
      letterNumber: "MWCA/3/8/16/02-2026",
      letterDate: dayToDate(today()),
      validUntil: dayToDate(defaultValidUntil(today())),
      note: "පළමු ලිපිය",
      byId: ho.userId,
    });
    for (const c of [first, second]) {
      expect((await load(c.id)).status).toBe("IN_PROGRESS");
      const release = await db.release.findUniqueOrThrow({ where: { caseId: c.id } });
      expect(release).toMatchObject({ letterId, amount: 2_000_000, releasedOn: dayToDate(today()) });
      const installments = await db.installment.findMany({ where: { caseId: c.id }, orderBy: { number: "asc" } });
      expect(installments.map((i) => [i.number, i.amount, i.status])).toEqual([
        [1, 500_000, "NOT_STARTED"],
        [2, 500_000, "NOT_STARTED"],
        [3, 500_000, "NOT_STARTED"],
        [4, 500_000, "NOT_STARTED"],
      ]);
      expect(await db.notification.count({ where: { caseId: c.id, userId: dsA.userId, type: "RELEASED" } })).toBe(1);
      const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: c.id, action: "case_released" } });
      expect(audit.after).toMatchObject({
        status: "IN_PROGRESS",
        amount: 2_000_000,
        letterId,
        letterNumber: "MWCA/3/8/16/02-2026",
        cases: 2,
      });
    }
    // The case left off the letter still waits for one.
    expect((await load(left.id)).status).toBe("VERIFIED");
    expect(await db.auditLog.count({ where: { entityId: letterId, action: "letter_recorded" } })).toBe(1);

    const details = await getCase(db, dsA, first.id, "si");
    expect(details?.release).toMatchObject({
      releasedOn: today(),
      amount: 2_000_000,
      letter: { id: letterId, letterNumber: "MWCA/3/8/16/02-2026", cases: 2, note: "පළමු ලිපිය", scanId: null },
    });
    expect(details?.installments).toHaveLength(4);
    expect(await getLetter(db, ho, letterId, "si")).toMatchObject({ count: 2, offices: [details?.officeName] });
    expect((await recentLetters(db, ho, "si"))[0]?.id).toBe(letterId);
    expect(await getLetter(db, dsA, letterId, "si")).toBeNull();
  });

  it("lists the districts waiting for a letter and each one's verified cases, for Head Office only", async () => {
    const first = await verified("200200000022");
    const second = await verified("200200000023");
    const districtId = await districtOf(first.dsOfficeId);

    const waiting = await districtsWaiting(db, ho, "si");
    const here = waiting.find((d) => d.id === districtId);
    expect(here?.count).toBe(await db.case.count({ where: { status: "VERIFIED", dsOffice: { districtId } } }));
    expect(waiting.reduce((sum, d) => sum + d.count, 0)).toBe((await queueCounts(db, ho)).release);
    const counts = waiting.map((d) => d.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));

    const ids = (await casesForLetter(db, ho, districtId, "si")).map((c) => c.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    for (const actor of [dsA, admin]) {
      expect(await districtsWaiting(db, actor, "si")).toEqual([]);
      expect(await casesForLetter(db, actor, districtId, "si")).toEqual([]);
      expect(await recentLetters(db, actor, "si")).toEqual([]);
    }
  });

  it("refuses a missing number, a future date, a date before a verification and an end before the date", async () => {
    const early = await verified("200200000031");
    const late = await verified("200200000037");
    await db.case.update({ where: { id: early.id }, data: { verifiedAt: new Date(Date.now() - 10 * DAY) } });
    await db.case.update({ where: { id: late.id }, data: { verifiedAt: new Date(Date.now() - 3 * DAY) } });
    const refused = async (overrides: Partial<Record<ReleaseField, string>>) => {
      const result = await recordLetter(db, ho, await letter([early, late], overrides));
      return result.ok ? null : result.errors;
    };

    expect(await refused({ letterNumber: "" })).toEqual({ letterNumber: "numberRequired" });
    expect(await refused({ letterDate: colomboDay(new Date(Date.now() + DAY)) })).toEqual({
      letterDate: "dateInFuture",
    });
    // The later of the two verifications is the earliest the letter can be dated.
    expect(await refused({ letterDate: daysAgo(5) })).toEqual({ letterDate: "dateBeforeVerified" });
    expect(await refused({ letterDate: daysAgo(3), validUntil: daysAgo(4) })).toEqual({
      validUntil: "untilBeforeDate",
    });
    expect(await refused({ letterDate: "2026-02-30" })).toEqual({ letterDate: "dateInvalid" });
    for (const c of [early, late]) {
      expect((await load(c.id)).status).toBe("VERIFIED");
      expect(await db.installment.count({ where: { caseId: c.id } })).toBe(0);
    }
    expect(await recordLetter(db, ho, await letter([early, late], { letterDate: daysAgo(3) }))).toMatchObject({
      ok: true,
    });
  });

  it("releases all or nothing, and refuses no case, another district, a DS officer, an admin and an old form", async () => {
    const sent = await submitted("200200000032");
    const ready = await verified("200200000033");
    const record = async (actor: Actor, cases: Ticked[]) => recordLetter(db, actor, await letter(cases));

    expect(await record(ho, [ready, sent])).toEqual({ ok: false, error: "notAllowedNow", errors: {} });
    expect((await load(ready.id)).status).toBe("VERIFIED");
    expect(await recordLetter(db, ho, { ...(await letter([ready])), cases: [] })).toEqual({
      ok: false,
      error: "noCases",
      errors: {},
    });
    // A case of another district can't go on this district's letter.
    const elsewhere = await db.dsOffice.findFirstOrThrow({
      where: { active: true, districtId: { not: await districtOf(ready.dsOfficeId) } },
      select: { id: true },
    });
    const saved = await saveCase(db, ho, input("200200000038", { dsOfficeId: elsewhere.id, submit: true }));
    if (!saved.ok) throw new Error(saved.error);
    const sentThere = await load(saved.value.id);
    await decideCase(db, ho, { caseId: sentThere.id, version: sentThere.version, decision: "verify", reason: null });
    const there = await load(sentThere.id);
    const both = [ready, there].map(({ id, version }) => ({ id, version }));
    expect(await recordLetter(db, ho, { ...(await letter([ready])), cases: both })).toEqual({
      ok: false,
      error: "notFound",
      errors: {},
    });

    expect(await record(dsA, [ready])).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect(await record(admin, [ready])).toEqual({ ok: false, error: "notFound", errors: {} });
    expect(await record(ho, [{ ...ready, version: ready.version - 1 }])).toEqual({
      ok: false,
      error: "conflict",
      errors: {},
    });
    expect(await db.release.count({ where: { caseId: { in: [ready.id, there.id] } } })).toBe(0);

    expect(await record(ho, [ready])).toMatchObject({ ok: true });
    expect(await record(ho, [ready])).toEqual({ ok: false, error: "notAllowedNow", errors: {} });
    expect(await db.release.count({ where: { caseId: ready.id } })).toBe(1);
    expect(await db.installment.count({ where: { caseId: ready.id } })).toBe(4);
  });

  it("keeps the officer's own scan with the letter, which only the letter's offices may open", async () => {
    const ready = await verified("200200000039");
    const pdf = { name: "ලිපිය.pdf", bytes: new TextEncoder().encode("%PDF-1.4\n% test letter\n") };
    expect(await uploadLetterScan(db, dsA, pdf)).toEqual({ ok: false, error: "notAllowed" });
    const scan = await uploadLetterScan(db, ho, pdf);
    if (!scan.ok) throw new Error(scan.error);
    // Someone else's upload can't be attached.
    const other: Actor = { userId: "review-test-ho-2", role: "HO_OFFICER", dsOfficeId: null };
    await db.user.create({
      data: { id: other.userId, name: "ප්‍ර. දෙවන", email: "review-test-ho-2@no-email.invalid", role: "HO_OFFICER" },
    });
    expect(await recordLetter(db, other, { ...(await letter([ready])), scanId: scan.value.id })).toEqual({
      ok: false,
      error: "scanUnavailable",
      errors: {},
    });
    expect((await load(ready.id)).status).toBe("VERIFIED");

    const result = await recordLetter(db, ho, { ...(await letter([ready])), scanId: scan.value.id });
    expect(result).toMatchObject({ ok: true });
    expect(await db.storedFile.findUniqueOrThrow({ where: { id: scan.value.id } })).toMatchObject({
      kind: "LETTER",
      letterId: result.ok ? result.letterId : "",
      caseId: null,
    });
    expect((await getCase(db, ho, ready.id, "si"))?.release?.letter.scanId).toBe(scan.value.id);
    expect(await fileForViewer(db, dsA, scan.value.id)).toMatchObject({ originalName: "ලිපිය.pdf" });
    expect(await fileForViewer(db, other, scan.value.id)).not.toBeNull();
    expect(await fileForViewer(db, dsB, scan.value.id)).toBeNull();
    expect(await fileForViewer(db, admin, scan.value.id)).toBeNull();
  });

  it("can't hold any other amount, or a letter valid before its date, even when written directly to the database", async () => {
    const [running] = await released("200200000034");
    const { letterId } = await db.release.findUniqueOrThrow({ where: { caseId: running.id } });
    const ready = await verified("200200000043");
    await expect(
      db.release.create({
        data: {
          id: randomUUID(),
          caseId: ready.id,
          letterId,
          releasedOn: dayToDate(today()),
          amount: 1_500_000,
          byId: ho.userId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.installment.create({ data: { id: randomUUID(), caseId: ready.id, number: 5, amount: 500_000 } }),
    ).rejects.toThrow();
    await expect(
      db.releaseLetter.create({
        data: {
          id: randomUUID(),
          districtId: await districtOf(ready.dsOfficeId),
          letterNumber: "X",
          letterDate: dayToDate(today()),
          validUntil: dayToDate(daysAgo(1)),
          byId: ho.userId,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("correcting a release's letter (REL-4)", () => {
  it("changes the letter for every case on it, logging the old and new value of each field on each", async () => {
    const [running, other] = await released("200200000040", "200200000044");
    const result = await correctRelease(db, ho, {
      caseId: running.id,
      version: running.version,
      form: letterForm({ letterNumber: "MWCA/3/8/16/09-2026", validUntil: "2027-03-31", note: "නිවැරදි කළා" }),
    });

    expect(result).toEqual({ ok: true });
    const { letterId } = await db.release.findUniqueOrThrow({ where: { caseId: running.id } });
    expect(await db.releaseLetter.findUniqueOrThrow({ where: { id: letterId } })).toMatchObject({
      letterNumber: "MWCA/3/8/16/09-2026",
      validUntil: dayToDate("2027-03-31"),
      note: "නිවැරදි කළා",
    });
    for (const c of [running, other]) {
      const audit = await db.auditLog.findFirstOrThrow({ where: { caseId: c.id, action: "release_corrected" } });
      expect(audit).toMatchObject({
        actorId: ho.userId,
        entityId: letterId,
        before: { letterNumber: "MWCA/3/8/16/01-2026", validUntil: defaultValidUntil(today()), note: null },
        after: { letterNumber: "MWCA/3/8/16/09-2026", validUntil: "2027-03-31", note: "නිවැරදි කළා" },
      });
      expect((await load(c.id)).version).toBe(c.version + 1);
    }
    // The other case's page, opened before the correction, can't overwrite it.
    expect(await correctRelease(db, ho, { caseId: other.id, version: other.version, form: letterForm() })).toEqual({
      ok: false,
      error: "conflict",
      errors: {},
    });
  });

  it("can't move the date past an installment of any case on it, or before a verification; only Head Office corrects", async () => {
    const [running, other] = await released("200200000041", "200200000045");
    // Both verified 10 days ago; the other case's first installment expected 5 days ago (Phase 6 records those).
    await db.case.updateMany({
      where: { id: { in: [running.id, other.id] } },
      data: { verifiedAt: new Date(Date.now() - 10 * DAY) },
    });
    await db.installment.updateMany({
      where: { caseId: other.id, number: 1 },
      data: { status: "PROCESSING", expectedOn: dayToDate(daysAgo(5)) },
    });
    const correct = (actor: Actor, letterDate: string) =>
      correctRelease(db, actor, { caseId: running.id, version: running.version, form: letterForm({ letterDate }) });

    expect(await correct(dsA, daysAgo(6))).toEqual({ ok: false, error: "roleNotAllowed", errors: {} });
    expect(await correct(ho, daysAgo(3))).toEqual({
      ok: false,
      error: null,
      errors: { letterDate: "dateAfterInstallment" },
    });
    expect(await correct(ho, daysAgo(11))).toEqual({
      ok: false,
      error: null,
      errors: { letterDate: "dateBeforeVerified" },
    });
    expect(await correct(ho, daysAgo(6))).toEqual({ ok: true });
    for (const c of [running, other]) {
      expect((await db.release.findUniqueOrThrow({ where: { caseId: c.id } })).releasedOn).toEqual(
        dayToDate(daysAgo(6)),
      );
    }

    const notYet = await verified("200200000042");
    expect(await correctRelease(db, ho, { caseId: notYet.id, version: notYet.version, form: letterForm() })).toEqual({
      ok: false,
      error: "noRelease",
      errors: {},
    });
  });
});

describe("changing a verified case (CASE-9)", () => {
  it("lets Head Office change it, logging the old and new value of each field", async () => {
    const ready = await verified("200200000050");
    const result = await saveCase(db, ho, {
      ...input("200200000050"),
      id: ready.id,
      version: ready.version,
      values: values("200200000050", { mobile1: "0770000050" }),
    });

    expect(result).toMatchObject({ ok: true, value: { status: "VERIFIED" } });
    expect((await load(ready.id)).mobile1).toBe("0770000050");
    const audit = await db.auditLog.findFirstOrThrow({
      where: { caseId: ready.id, action: "case_updated" },
      orderBy: { id: "desc" },
    });
    expect(audit).toMatchObject({
      actorId: ho.userId,
      before: { mobile1: "0710000001" },
      after: { mobile1: "0770000050", documentsAdded: [] },
    });
  });

  it("refuses the DS office, an empty required field and a submit", async () => {
    const [running] = await released("200200000051");
    const change = (actor: Actor, overrides: Partial<SaveCaseInput>) =>
      saveCase(db, actor, { ...input("200200000051"), id: running.id, version: running.version, ...overrides });

    expect(await change(dsA, {})).toEqual({ ok: false, error: "notEditable" });
    expect(await change(ho, { values: values("200200000051", { name: null }) })).toEqual({
      ok: false,
      error: "incomplete",
    });
    expect(await change(ho, { submit: true })).toEqual({ ok: false, error: "notAllowedNow" });
    expect((await load(running.id)).status).toBe("IN_PROGRESS");
  });
});

describe("notifications (NTF-1)", () => {
  it("shows the office's officer their notices, newest first, and opening one marks it read", async () => {
    const ready = await verified("200200000060");
    await recordLetter(db, ho, await letter([ready]));

    const mine = (await listNotifications(db, dsA)).filter((n) => n.caseId === ready.id);
    expect(mine.map((n) => [n.type, n.read])).toEqual([
      ["RELEASED", false],
      ["VERIFIED", false],
    ]);
    const before = await unreadCount(db, dsA);
    expect((await unreadNow(db, dsA)).count).toBe(before);
    expect(await openNotification(db, dsA, mine[0]!.id)).toEqual({ caseId: ready.id });
    expect(await unreadCount(db, dsA)).toBe(before - 1);
    // Opening it again changes nothing.
    expect(await openNotification(db, dsA, mine[0]!.id)).toEqual({ caseId: ready.id });
    expect(await unreadCount(db, dsA)).toBe(before - 1);
  });

  it("keeps them from everyone else, and from the officer once moved to another office (PRM-3)", async () => {
    const ready = await verified("200200000061");
    const notice = await db.notification.findFirstOrThrow({ where: { caseId: ready.id, userId: dsA.userId } });

    expect(await openNotification(db, dsB, notice.id)).toBeNull();
    expect(await openNotification(db, ho, notice.id)).toBeNull();
    const moved: Actor = { ...dsA, dsOfficeId: dsB.dsOfficeId };
    expect((await listNotifications(db, moved)).some((n) => n.id === notice.id)).toBe(false);
    expect(await openNotification(db, moved, notice.id)).toBeNull();
    expect(await listNotifications(db, admin)).toEqual([]);
  });
});
