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
  districtName: "කොළඹ",
  officeName: "හෝමාගම",
  // 01:30 on 2 March in Colombo, still 1 March in UTC.
  createdAt: new Date("2026-03-01T20:00:00Z"),
  completedAt: null,
  updatedAt: new Date("2026-04-05T06:00:00Z"),
  remark: null,
  release: { releasedOn: "2026-03-10", amount: 2_000_000, paidOut: 1_000_000 },
  installments: [
    { status: "RELEASED", expectedOn: "2026-03-12", releasedOn: "2026-03-15" },
    { status: "PROCESSING", expectedOn: "2026-04-17", releasedOn: null },
    { status: "NOT_STARTED", expectedOn: null, releasedOn: null },
    { status: "NOT_STARTED", expectedOn: null, releasedOn: null },
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
  release: null,
  installments: [null, null, null, null],
  progress: [null, null, null, null],
};

async function reopen(rows: ExportRow[]): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  addSheet(workbook, t("export.sheet"), caseListColumns(t), rows);
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
// The financial progress follows the amount released, and the physical progress the balance.
const AFTER_RELEASED = COLUMNS.indexOf(t("export.columns.released")) + 1;
const AFTER_BALANCE = COLUMNS.indexOf(t("export.columns.balance")) + 1;
/** The sheet's column numbers where each group starts. */
const MONEY_AT = AFTER_RELEASED + 1;
const BUILDING_AT = AFTER_BALANCE + MONEY.length + 1;

describe("the case list's Excel file (EXP-1)", () => {
  it("has a Sinhala sheet name and headers, one row per case, and a two-row header that stays in view", async () => {
    const sheet = await reopen([released, waiting]);
    expect(sheet.name).toBe("ප්‍රතිලාභීන්");
    const inOrder = (money: string[], building: string[]) => [
      ...COLUMNS.slice(0, AFTER_RELEASED),
      ...money,
      ...COLUMNS.slice(AFTER_RELEASED, AFTER_BALANCE),
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
    expect(cell("releasedOn").value).toEqual(new Date("2026-03-10T00:00:00Z"));

    expect(cell("released").value).toBe(2_000_000);
    expect(cell("released").numFmt).toBe("#,##0");
    expect(cell("paidOut").value).toBe(1_000_000);
    expect(cell("balance").value).toBe(1_000_000);

    const second = byHeader(sheet, 4);
    expect(second("nic").value).toBe("198800012345");
    expect(second("mobile1").value).toBe("0112345678");
    expect(second("number").value).toBe("HMG/2026/17");
    expect(second("status").value).toBe("ප්‍රතිපාදන මුදා හැරීමට ඇත");
  });

  it("leaves the money, stage and date columns empty for a case that hasn't got that far", async () => {
    const sheet = await reopen([waiting]);
    const cell = byHeader(sheet, 3);
    for (const key of ["releasedOn", "released", "paidOut", "balance", "completedOn"] as const)
      expect(cell(key).value, key).toBeNull();
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
    addSheet(workbook, tEn("export.sheet"), caseListColumns(tEn), [released]);
    const sheet = workbook.getWorksheet("Beneficiaries")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Registration number");
    expect(sheet.getRow(3).getCell(4).value).toBe("Work in progress");
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
