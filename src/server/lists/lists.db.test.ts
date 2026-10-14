import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { createTestClient, freeOfficeId } from "../../../tests/db/client";
import { addOffice, addStage, moveStage, renameOffice, renameStage, setOfficeActive, setStageActive } from "./commands";
import { officesOfDistrict, stagesByKind } from "./queries";

const db = createTestClient();
const ADMIN = "lists-test-admin";
let colombo: number;

beforeAll(async () => {
  await seed(db);
  colombo = (await db.district.findUniqueOrThrow({ where: { nameEn: "Colombo" } })).id;
});

afterAll(() => db.$disconnect());

const audits = (entityType: string) => db.auditLog.findMany({ where: { entityType }, orderBy: { id: "asc" } });

describe("DS offices (LST-2, LST-3)", () => {
  it("adds an office to a district, with an audit record", async () => {
    expect(
      await addOffice(db, ADMIN, colombo, {
        nameSi: "පරීක්ෂණ කාර්යාලය",
        nameTa: "சோதனை அலுவலகம்",
        nameEn: "Test Office",
        code: "KOL",
      }),
    ).toEqual({
      ok: true,
    });
    const listed = await officesOfDistrict(db, colombo, "si");
    expect(listed?.offices.map((o) => o.code)).toContain("KOL");
    expect((await audits("ds_office")).at(-1)?.action).toBe("office_added");
  });

  it("refuses a code used anywhere, or a name used in the same district", async () => {
    const names = { nameTa: "புதிய அலுவலகம்", nameEn: "New Office" };
    expect(await addOffice(db, ADMIN, colombo, { nameSi: "නව කාර්යාලය", ...names, code: "HMG" })).toEqual({
      ok: false,
      error: "codeTaken",
    });
    expect(await addOffice(db, ADMIN, colombo, { nameSi: "හෝමාගම", ...names, code: "HMX" })).toEqual({
      ok: false,
      error: "nameTaken",
    });
  });

  it("renames and deactivates an office without deleting it", async () => {
    const kol = await db.dsOffice.findUniqueOrThrow({ where: { code: "KOL" } });
    const renamed = { nameSi: "පරීක්ෂණ කාර්යාලය නව", nameTa: "புதிய சோதனை அலுவலகம்", nameEn: "Test Office New" };
    expect(await renameOffice(db, ADMIN, kol.id, renamed)).toEqual({ ok: true });
    expect(await setOfficeActive(db, ADMIN, kol.id, false)).toEqual({ ok: true });

    const after = await db.dsOffice.findUniqueOrThrow({ where: { code: "KOL" } });
    expect(after).toMatchObject({ ...renamed, code: "KOL", active: false });
    const audit = (await audits("ds_office")).find((a) => a.action === "office_renamed");
    expect(audit?.before).toEqual({ nameSi: "පරීක්ෂණ කාර්යාලය", nameTa: "சோதனை அலுவலகம்", nameEn: "Test Office" });
    expect(audit?.after).toEqual(renamed);
  });

  it("names every active officer of each office (ADM-3)", async () => {
    const office = await db.dsOffice.findUniqueOrThrow({ where: { id: await freeOfficeId(db) } });
    const officersOf = async () =>
      (await officesOfDistrict(db, office.districtId, "si"))?.offices.find((o) => o.id === office.id)?.officers;
    expect(await officersOf()).toEqual([]);

    const officer = (id: string, name: string, username: string, banned = false) =>
      db.user.create({
        data: {
          id,
          name,
          email: `${id}@no-email.invalid`,
          username,
          role: "DS_OFFICER",
          dsOfficeId: office.id,
          banned,
        },
      });
    await officer("lists-officer", "කේ. නිලධාරී", "ds9300");
    await officer("lists-officer-2", "ඒ. නිලධාරී", "ds9301");
    await officer("lists-officer-old", "ප. නිලධාරී", "ds9302", true);
    expect(await officersOf()).toEqual(["ඒ. නිලධාරී", "කේ. නිලධාරී"]);
  });

  it("names districts and provinces in the screen's language (UI-9)", async () => {
    const [si, ta, en] = await Promise.all([
      officesOfDistrict(db, colombo, "si"),
      officesOfDistrict(db, colombo, "ta"),
      officesOfDistrict(db, colombo, "en"),
    ]);
    expect([si?.district.name, ta?.district.name, en?.district.name]).toEqual(["කොළඹ", "கொழும்பு", "Colombo"]);
    expect([si?.district.province, ta?.district.province, en?.district.province]).toEqual([
      "බස්නාහිර",
      "மேல்",
      "Western",
    ]);
    // The admin edits all three names of an office, whatever the screen's language.
    expect(ta?.offices.find((o) => o.code === "HMG")).toMatchObject({
      nameSi: "හෝමාගම",
      nameTa: "ஹோமாகம",
      nameEn: "Homagama",
    });
  });
});

describe("building stages (LST-4)", () => {
  it("adds renovation stages in order and moves one up", async () => {
    const roof = { nameSi: "වහලය අලුත්වැඩියාව", nameTa: "கூரை திருத்தம்", nameEn: "Roof repair" };
    const walls = { nameSi: "බිත්ති අලුත්වැඩියාව", nameTa: "சுவர் திருத்தம்", nameEn: "Wall repair" };
    expect(await addStage(db, ADMIN, "RENOVATION", roof)).toEqual({ ok: true });
    expect(await addStage(db, ADMIN, "RENOVATION", walls)).toEqual({ ok: true });
    expect(await addStage(db, ADMIN, "RENOVATION", { ...roof, nameEn: "Another" })).toEqual({
      ok: false,
      error: "nameTaken",
    });

    const second = (await stagesByKind(db)).RENOVATION[1];
    expect(await moveStage(db, ADMIN, second.id, "up")).toEqual({ ok: true });
    expect((await stagesByKind(db)).RENOVATION.map((s) => s.nameSi)).toEqual([
      "බිත්ති අලුත්වැඩියාව",
      "වහලය අලුත්වැඩියාව",
    ]);
  });

  it("leaves the first stage where it is when moved up", async () => {
    const first = (await stagesByKind(db)).NEW_HOUSE[0];
    expect(await moveStage(db, ADMIN, first.id, "up")).toEqual({ ok: true });
    expect((await stagesByKind(db)).NEW_HOUSE[0].id).toBe(first.id);
  });

  it("renames and deactivates a stage, keeping the new-house list intact", async () => {
    const [renovation] = (await stagesByKind(db)).RENOVATION;
    const renamed = { nameSi: "බිත්ති සහ ජනේල", nameTa: "சுவர்கள் மற்றும் ஜன்னல்கள்", nameEn: "Walls and windows" };
    expect(await renameStage(db, ADMIN, renovation.id, renamed)).toEqual({ ok: true });
    // Only the Tamil name changes: still a rename.
    expect(await renameStage(db, ADMIN, renovation.id, { ...renamed, nameTa: "சுவர்களும் ஜன்னல்களும்" })).toEqual({
      ok: true,
    });
    expect(await setStageActive(db, ADMIN, renovation.id, false)).toEqual({ ok: true });

    const stages = await stagesByKind(db);
    expect(stages.RENOVATION[0]).toMatchObject({ ...renamed, nameTa: "சுவர்களும் ஜன்னல்களும்", active: false });
    expect(stages.NEW_HOUSE).toHaveLength(4);
    expect((await audits("stage_definition")).map((a) => a.action)).toEqual(
      expect.arrayContaining(["stage_added", "stage_moved", "stage_renamed", "stage_deactivated"]),
    );
  });
});
