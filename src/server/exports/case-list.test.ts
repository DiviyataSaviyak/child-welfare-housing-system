import ExcelJS from "exceljs";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import messages from "../../../messages/si.json";
import ta from "../../../messages/ta.json";
import { caseListColumns, type ExportRow, progressStages } from "./case-list";
import { addSheet, workbookBytes, XLSX_TYPE, xlsxResponse } from "./workbook";

const t = createTranslator({ locale: "si", messages, namespace: "cases" });

/** Made-up cases (SEC-11). */
const released: ExportRow = {
  applicationNumber: "HMG-2026-001",
  category: "CHILD_AT_RISK",
  kind: "NEW_HOUSE",
  status: "IN_PROGRESS",
  name: "ඒ. බී. පරීක්ෂණ",
  childName: "සී. පරීක්ෂණ",
  nic: "880001234V",
  address: "1, පරීක්ෂණ පාර, හෝමාගම",
  gnDivision: "හෝමාගම නැගෙනහිර",
  mobile1: "0771234567",
  mobile2: null,
  dateOfBirth: "2012-06-30",
  careGroup: null,
  maritalStatus: null,
  relationship: "OTHER",
  relationshipOther: "ආච්චි",
  centres: [],
  familyMembers: 4,
  disabledChildren: false,
  aid: ["SAMURDHI", "OTHER"],
  aidOther: "ප්‍රාදේශීය සභා ආධාර",
  landGnDivision: "ගම්පහ උතුර",
  districtName: "ගම්පහ",
  officeName: "ගම්පහ",
  // CASE-13: entered by Homagama, built in Gampaha.
  residenceOfficeName: "හෝමාගම",
  // 01:30 on 2 March in Colombo, still 1 March in UTC.
  createdAt: new Date("2026-03-01T20:00:00Z"),
  completedAt: null,
  updatedAt: new Date("2026-04-05T06:00:00Z"),
  remark: null,
  release: {
    amount: 2_000_000,
    letterNumber: "MWCA/DS/2026/04",
    letterDate: "2026-03-05",
    dsRelease: { referenceNumber: "GMP/2026/11", releasedOn: "2026-03-10", paidOut: 1_000_000 },
  },
  installments: [
    { status: "RELEASED", amount: 500_000, expectedOn: "2026-03-12", releasedOn: "2026-03-15" },
    { status: "PROCESSING", amount: 500_000, expectedOn: "2026-04-17", releasedOn: null },
    { status: "NOT_STARTED", amount: 500_000, expectedOn: null, releasedOn: null },
    { status: "NOT_STARTED", amount: 500_000, expectedOn: null, releasedOn: null },
  ],
  progress: ["2026-03-20", null, null, null],
};

const waiting: ExportRow = {
  ...released,
  applicationNumber: "HMG/2026/17",
  category: "CARE_LEAVER",
  kind: "RENOVATION",
  status: "AWAITING_ALLOCATION",
  childName: null,
  nic: "198800012345",
  mobile1: "0112345678",
  dateOfBirth: "2003-01-15",
  careGroup: "LEFT_CARE",
  maritalStatus: "UNMARRIED",
  relationship: null,
  relationshipOther: null,
  centres: [
    {
      name: "පරීක්ෂණ ළමා නිවාසය",
      provinceName: "බස්නාහිර",
      from: { year: 2010, month: 3, day: null },
      until: { year: 2015, month: null, day: null },
    },
    { name: "දෙවන පරීක්ෂණ නිවාසය", provinceName: "මධ්‍යම", from: null, until: null },
  ],
  familyMembers: 1,
  disabledChildren: true,
  aid: [],
  aidOther: null,
  release: null,
  installments: [null, null, null, null],
  progress: [null, null, null, null],
};

/** On the Ministry's letter, waiting for the District's release: no installments yet. */
const allocated: ExportRow = {
  ...released,
  applicationNumber: "HMG/2026/18",
  status: "ALLOCATED_TO_DISTRICT",
  districtName: "කොළඹ",
  officeName: "හෝමාගම",
  release: { ...released.release!, dsRelease: null },
  installments: [null, null, null, null],
  progress: [null, null, null, null],
};

/** A land case paid in amounts of its own (INS-7): Rs. 900,000 paid, Rs. 400,000 being paid. */
const land: ExportRow = {
  ...released,
  applicationNumber: "HMG/2026/19",
  kind: "LAND_AND_BUILD",
  release: { ...released.release!, dsRelease: { ...released.release!.dsRelease!, paidOut: 900_000 } },
  installments: [
    { status: "RELEASED", amount: 900_000, expectedOn: "2026-03-12", releasedOn: "2026-03-12" },
    { status: "PROCESSING", amount: 400_000, expectedOn: "2026-04-17", releasedOn: null },
    null,
    null,
  ],
};

/** Entered before change 0007: none of the registration form's details. */
const older: ExportRow = {
  ...released,
  applicationNumber: "HMG/2026/20",
  dateOfBirth: null,
  relationship: null,
  relationshipOther: null,
  familyMembers: null,
  disabledChildren: null,
  aid: [],
  aidOther: null,
  landGnDivision: null,
};

async function reopen(rows: ExportRow[], translate = t, locale: "si" | "en" = "si"): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  addSheet(workbook, translate("export.sheet"), caseListColumns(translate, locale), rows);
  const again = new ExcelJS.Workbook();
  await again.xlsx.load((await workbookBytes(workbook)).buffer);
  return again.worksheets[0];
}

/** A row's cells by their Sinhala header, from the header's second row (the first one's merge down into it). */
function byHeader(sheet: ExcelJS.Worksheet, rowNumber: number) {
  const headers = sheet.getRow(2).values as unknown[];
  const row = sheet.getRow(rowNumber);
  return (key: keyof typeof messages.cases.export.columns) => row.getCell(headers.indexOf(t(`export.columns.${key}`)));
}

const COLUMNS = Object.keys(messages.cases.export.columns).map((key) =>
  t(`export.columns.${key as keyof typeof messages.cases.export.columns}`),
);
const MONEY = ["පළමු වාරිකය", "දෙවන වාරිකය", "තුන්වන වාරිකය", "සිව්වන වාරිකය"];
const BUILDING = ["අත්තිවාරම යෙදීම", "බිත්ති ගොඩනැංවීම", "වහළය සකස් කිරීම", "අත්‍යවශ්‍ය අංග සමඟ නිවස සම්පූර්ණ කිරීම"];
// The financial progress follows the amount allocated, and the physical progress the balance.
const AFTER_ALLOCATED = COLUMNS.indexOf(t("export.columns.allocated")) + 1;
const AFTER_BALANCE = COLUMNS.indexOf(t("export.columns.balance")) + 1;
/** The sheet's column numbers where each group starts. */
const MONEY_AT = AFTER_ALLOCATED + 1;
const BUILDING_AT = AFTER_BALANCE + MONEY.length + 1;

describe("the case list's Excel file (EXP-1)", () => {
  it("has a Sinhala sheet name and headers, one row per case, and a two-row header that stays in view", async () => {
    const sheet = await reopen([released, waiting]);
    expect(sheet.name).toBe("ප්‍රතිලාභීන්");
    const inOrder = (money: string[], building: string[]) => [
      ...COLUMNS.slice(0, AFTER_ALLOCATED),
      ...money,
      ...COLUMNS.slice(AFTER_ALLOCATED, AFTER_BALANCE),
      ...building,
      ...COLUMNS.slice(AFTER_BALANCE),
    ];
    // A merged cell reads as the merge's first cell, so the case-list headers show on both rows.
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(
      inOrder(
        MONEY.map(() => "මූල්‍ය ප්‍රගතිය (රු)"),
        BUILDING.map(() => "භෞතික ප්‍රගතිය"),
      ),
    );
    expect((sheet.getRow(2).values as unknown[]).slice(1)).toEqual(inOrder(MONEY, BUILDING));
    expect(COLUMNS).not.toContain("ගෙවූ වාරික ගණන");
    expect(COLUMNS).not.toContain("ළඟා වූ මට්ටම");
    expect(sheet.rowCount).toBe(4);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 2 });
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.getRow(2).font?.bold).toBe(true);
  });

  it("puts each case-list header over both rows, and each group's header over its four columns", async () => {
    const sheet = await reopen([released]);
    const last = COLUMNS.length + 8;
    for (const column of [1, MONEY_AT - 1, MONEY_AT + 4, BUILDING_AT - 1, BUILDING_AT + 4, last])
      expect(sheet.getCell(2, column).master.address).toBe(sheet.getCell(1, column).address);
    for (const first of [MONEY_AT, BUILDING_AT]) {
      for (let column = first; column < first + 4; column++) {
        expect(sheet.getCell(1, column).master.address).toBe(sheet.getCell(1, first).address);
        expect(sheet.getCell(2, column).isMerged).toBe(false);
      }
      expect(sheet.getCell(1, first).alignment?.horizontal).toBe("center");
    }
    expect(sheet.columnCount).toBe(last);
  });

  it("writes a short dated note, as the old sheet did: when each installment was paid or is expected, and when each stage was finished", async () => {
    const sheet = await reopen([released, waiting]);
    const row = sheet.getRow(3);
    const [money, building] = [MONEY_AT, BUILDING_AT];
    expect([0, 1, 2, 3].map((i) => row.getCell(money + i).value)).toEqual([
      "2026.03.15 දින ගෙවා ඇත",
      "2026.04.17 දින ගෙවීමට අපේක්ෂිතයි",
      null,
      null,
    ]);
    expect([0, 1, 2, 3].map((i) => row.getCell(building + i).value)).toEqual([
      "2026.03.20 දින නිම කර ඇත",
      null,
      null,
      null,
    ]);
    expect(row.getCell(money).alignment).toMatchObject({ wrapText: true });
    const empty = sheet.getRow(4);
    for (let i = 0; i < 4; i++) {
      expect(empty.getCell(money + i).value).toBeNull();
      expect(empty.getCell(building + i).value).toBeNull();
    }
  });

  it("writes the list's words, keeps NICs and phone numbers as text, and dates as Colombo days", async () => {
    const sheet = await reopen([released, waiting]);
    const cell = byHeader(sheet, 3);
    expect(cell("number").value).toBe("HMG-2026-001");
    expect(cell("category").value).toBe("අවදානම් දරුවන්");
    expect(cell("kind").value).toBe("නව නිවසක්");
    expect(cell("status").value).toBe("වැඩ සිදුවෙමින්");
    expect(cell("nic").value).toBe("880001234V");
    expect(cell("mobile1").value).toBe("0771234567");
    expect(cell("mobile2").value).toBeNull();

    expect(cell("enteredOn").value).toEqual(new Date("2026-03-02T00:00:00Z"));
    expect(cell("enteredOn").numFmt).toBe("yyyy.mm.dd");

    expect(cell("allocated").value).toBe(2_000_000);
    expect(cell("allocated").numFmt).toBe("#,##0");
    expect(cell("paidOut").value).toBe(1_000_000);
    expect(cell("balance").value).toBe(1_000_000);

    const second = byHeader(sheet, 4);
    expect(second("nic").value).toBe("198800012345");
    expect(second("mobile1").value).toBe("0112345678");
    expect(second("number").value).toBe("HMG/2026/17");
    expect(second("status").value).toBe("ප්‍රතිපාදන මුදා හැරීමට ඇත");
  });

  it("names where it is built, then the DS of residence (CASE-13)", async () => {
    const sheet = await reopen([released]);
    const cell = byHeader(sheet, 3);
    expect(
      COLUMNS.slice(COLUMNS.indexOf(t("export.columns.district")), COLUMNS.indexOf(t("export.columns.gnDivision"))),
    ).toEqual([
      "ඉදිකරන දිස්ත්‍රික්කය",
      "ඉදිකරන ප්‍රාදේශීය ලේකම් කොට්ඨාසය",
      "ඉඩමේ ග්‍රාම නිලධාරී වසම",
      "පදිංචි ප්‍රාදේශීය ලේකම් කොට්ඨාසය",
    ]);
    expect([
      cell("district").value,
      cell("office").value,
      cell("landGnDivision").value,
      cell("residenceOffice").value,
    ]).toEqual(["ගම්පහ", "ගම්පහ", "ගම්පහ උතුර", "හෝමාගම"]);
  });

  it("gives the Ministry's letter and the District's release in place of the days it was sent, verified and released", async () => {
    const sheet = await reopen([released]);
    const cell = byHeader(sheet, 3);
    expect(cell("letterNumber").value).toBe("MWCA/DS/2026/04");
    expect(cell("letterDate").value).toEqual(new Date("2026-03-05T00:00:00Z"));
    expect(cell("letterDate").numFmt).toBe("yyyy.mm.dd");
    expect(cell("dsReleaseReference").value).toBe("GMP/2026/11");
    expect(cell("dsReleasedOn").value).toEqual(new Date("2026-03-10T00:00:00Z"));
    for (const gone of ["ලියාපදිංචි අංකය", "රු. 2,000,000 නිදහස් කළ දිනය", "ප්‍රා.ලේ. කාර්යාලයට නිදහස් කළ මුදල (රු.)"])
      expect(COLUMNS).not.toContain(gone);
    expect(t("export.columns.number")).toBe("ඉල්ලුම් අංකය");
  });

  it("leaves the money, stage and date columns empty for a case that hasn't got that far", async () => {
    const sheet = await reopen([waiting, allocated]);
    const cell = byHeader(sheet, 3);
    const money = [
      "letterNumber",
      "letterDate",
      "dsReleaseReference",
      "dsReleasedOn",
      "allocated",
      "paidOut",
      "balance",
      "completedOn",
    ] as const;
    for (const key of money) expect(cell(key).value, key).toBeNull();

    // Allocated by the Ministry, not yet released by the District: the DS has received and paid nothing.
    const onLetter = byHeader(sheet, 4);
    expect(onLetter("letterNumber").value).toBe("MWCA/DS/2026/04");
    expect(onLetter("allocated").value).toBe(2_000_000);
    expect(onLetter("status").value).toBe("දිස්ත්‍රික්කයට මුදා හැර ඇත");
    for (const key of ["dsReleaseReference", "dsReleasedOn", "paidOut", "balance"] as const)
      expect(onLetter(key).value, key).toBeNull();
  });

  it("puts the filter buttons on the header's second row", async () => {
    const sheet = await reopen([released]);
    // Read back from the file, the range is in Excel's own form.
    expect(sheet.autoFilter).toBe(`A2:${sheet.getCell(2, COLUMNS.length + 8).address}`);
  });

  it("downloads as an attachment with a Sinhala file name and an ASCII stand-in, never cached", () => {
    const response = xlsxResponse(
      new Uint8Array([1, 2, 3]),
      t("export.fileName", { date: "2026-10-04" }),
      "diviyata-saviyak-2026-10-04.xlsx",
    );
    expect(response.headers.get("Content-Type")).toBe(XLSX_TYPE);
    expect(response.headers.get("Content-Length")).toBe("3");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="diviyata-saviyak-2026-10-04\.xlsx"; filename\*=UTF-8''/);
    expect(decodeURIComponent(disposition.split("''")[1])).toBe("දිවියට සවියක් ලැයිස්තුව 2026-10-04.xlsx");
  });

  it("names the file without zero-width joiners, which Chrome would save as '_'", () => {
    for (const [locale, file] of [
      ["si", messages],
      ["ta", ta],
      ["en", en],
    ] as const) {
      const name = createTranslator({ locale, messages: file, namespace: "cases" })("export.fileName", {
        date: "2026-10-04",
      });
      expect(name, locale).not.toMatch(/\p{Cf}/u);
    }
  });

  it("writes the headers and statuses in the screen's language (UI-9)", async () => {
    const tEn = createTranslator({ locale: "en", messages: en, namespace: "cases" });
    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, tEn("export.sheet"), caseListColumns(tEn, "en"), [released]);
    const sheet = workbook.getWorksheet("Beneficiaries")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Application Number");
    expect(sheet.getRow(3).getCell(4).value).toBe("Work in progress");
  });
});

describe("the registration form's columns (EXP-1, change 0007)", () => {
  const NEW_COLUMNS = [
    "dateOfBirth",
    "careGroup",
    "maritalStatus",
    "relationship",
    "centres",
    "familyMembers",
    "disabledChildren",
    "aid",
  ] as const;

  it("come right after the phones, in EXP-1's order", () => {
    const at = COLUMNS.indexOf(t("export.columns.mobile2")) + 1;
    expect(COLUMNS.slice(at, at + NEW_COLUMNS.length)).toEqual(NEW_COLUMNS.map((key) => t(`export.columns.${key}`)));
    expect(COLUMNS[at + NEW_COLUMNS.length]).toBe(t("export.columns.district"));
  });

  it("write a child at risk's details: the child's birthday as a date, the typed relationship and aid", async () => {
    const sheet = await reopen([released]);
    const cell = byHeader(sheet, 3);
    expect(cell("dateOfBirth").value).toEqual(new Date("2012-06-30T00:00:00Z"));
    expect(cell("dateOfBirth").numFmt).toBe("yyyy.mm.dd");
    expect(cell("relationship").value).toBe("වෙනත්: ආච්චි");
    expect(cell("familyMembers").value).toBe(4);
    expect(cell("familyMembers").numFmt).toBeUndefined();
    expect(cell("disabledChildren").value).toBe("නැත");
    expect(cell("aid").value).toBe("සමෘද්ධි, වෙනත්: ප්‍රාදේශීය සභා ආධාර");
    // A care leaver's details don't belong to a child at risk.
    for (const key of ["careGroup", "maritalStatus", "centres"] as const) expect(cell(key).value, key).toBeNull();
  });

  it("write a care leaver's group, marital status and each centre on its own line, as precise as entered", async () => {
    const sheet = await reopen([waiting]);
    const cell = byHeader(sheet, 3);
    expect(cell("careGroup").value).toBe(t("careGroup.LEFT_CARE"));
    expect(cell("maritalStatus").value).toBe(t("maritalStatus.UNMARRIED"));
    expect(cell("relationship").value).toBeNull();
    expect(cell("centres").value).toBe("පරීක්ෂණ ළමා නිවාසය, බස්නාහිර (2010.03 – 2015)\nදෙවන පරීක්ෂණ නිවාසය, මධ්‍යම");
    expect(cell("centres").alignment).toMatchObject({ wrapText: true });
    expect(cell("disabledChildren").value).toBe("ඔව්");
    // Asked, and none ticked.
    expect(cell("aid").value).toBe(t("page.noAid"));
  });

  it("leaves every new column empty on a case entered before the change", async () => {
    const sheet = await reopen([older]);
    const cell = byHeader(sheet, 3);
    for (const key of [...NEW_COLUMNS, "landGnDivision"] as const) expect(cell(key).value, key).toBeNull();
  });

  it("writes the aids and the relationship in the file's language", async () => {
    const tEn = createTranslator({ locale: "en", messages: en, namespace: "cases" });
    const sheet = await reopen([released], tEn, "en");
    const headers = sheet.getRow(2).values as unknown[];
    const cell = (key: (typeof NEW_COLUMNS)[number]) =>
      sheet.getRow(3).getCell(headers.indexOf(tEn(`export.columns.${key}`)));
    expect(cell("aid").value).toBe(`${tEn("aid.SAMURDHI")}, ${tEn("aid.OTHER")}: ප්‍රාදේශීය සභා ආධාර`);
    expect(cell("disabledChildren").value).toBe("No");
  });
});

describe("a land case's installments (EXP-1, INS-7)", () => {
  it("give each installment's amount with its date", async () => {
    const sheet = await reopen([land]);
    const row = sheet.getRow(3);
    expect([0, 1, 2, 3].map((i) => row.getCell(MONEY_AT + i).value)).toEqual([
      "2026.03.12 දින රු. 900,000 ගෙවා ඇත",
      "2026.04.17 දින රු. 400,000 ගෙවීමට අපේක්ෂිතයි",
      null,
      null,
    ]);
    expect(byHeader(sheet, 3)("paidOut").value).toBe(900_000);
    expect(byHeader(sheet, 3)("balance").value).toBe(1_100_000);
  });

  it("in English too", async () => {
    const tEn = createTranslator({ locale: "en", messages: en, namespace: "cases" });
    const sheet = await reopen([land], tEn, "en");
    expect(sheet.getRow(3).getCell(MONEY_AT).value).toBe("Rs. 900,000 paid on 2026.03.12");
  });
});

describe("the building-progress columns' stages", () => {
  it("gives the four new-house stages one column each", () => {
    expect(progressStages(["a", "b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the last stage in the last column, and the first stages before it", () => {
    expect(progressStages(["a", "b"])).toEqual(["a", null, null, "b"]);
    expect(progressStages(["a", "b", "c", "d", "e", "f"])).toEqual(["a", "b", "c", "f"]);
    expect(progressStages(["a"])).toEqual([null, null, null, "a"]);
  });

  it("leaves all four empty for a kind with no stages", () => {
    expect(progressStages([])).toEqual([null, null, null, null]);
  });
});
