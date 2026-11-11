import ExcelJS from "exceljs";
import { dayToDate } from "@/lib/dates";

/** A cell's value: text, a whole number, a calendar day ("YYYY-MM-DD"), or empty. */
export type CellValue = string | number | { day: string } | null;

/** One column of an exported sheet: its Sinhala header, its width in characters, and how to read a row. */
export type Column<Row> = {
  header: string;
  /**
   * A header over this column and its neighbours with the same group, as the Ministry's progress
   * report's "financial progress" stands over its four installments. The column's own header goes
   * in a second row.
   */
  group?: string;
  width: number;
  value: (row: Row) => CellValue;
  /** Amounts are whole rupees and show with thousands separators. */
  amount?: boolean;
  /** Long text wraps within the column instead of running under the next one. */
  wrap?: boolean;
};

/** Days show the way offices write them (UI-3), and stay real dates, so Excel can sort and filter them. */
const DAY_FORMAT = "yyyy.mm.dd";
const AMOUNT_FORMAT = "#,##0";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Adds one sheet: a bold header that stays in view and has Excel's filter buttons on its last row,
 * then one row per item. Text stays text, so NICs and phone numbers keep their leading zeros. When
 * some columns have a group, the header takes two rows: the group over its columns, and each column
 * without one spanning both rows.
 */
export function addSheet<Row>(workbook: ExcelJS.Workbook, name: string, columns: Column<Row>[], rows: Row[]) {
  const headerRows = columns.some((column) => column.group) ? 2 : 1;
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: headerRows }] });
  sheet.columns = columns.map((column) => ({ width: column.width }));

  if (headerRows === 1) sheet.addRow(columns.map((column) => column.header));
  else {
    sheet.addRow(columns.map((column) => column.group ?? column.header));
    sheet.addRow(columns.map((column) => column.header));
    columns.forEach((column, index) => {
      if (!column.group) sheet.mergeCells(1, index + 1, 2, index + 1);
      else if (columns[index - 1]?.group !== column.group) {
        let last = index;
        while (columns[last + 1]?.group === column.group) last++;
        if (last > index) sheet.mergeCells(1, index + 1, 1, last + 1);
      }
    });
  }
  for (let number = 1; number <= headerRows; number++) {
    const header = sheet.getRow(number);
    header.font = { bold: true };
    header.alignment = { vertical: "top", wrapText: true };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EFEA" } };
  }
  columns.forEach((column, index) => {
    if (column.group) sheet.getCell(1, index + 1).alignment = { vertical: "top", horizontal: "center", wrapText: true };
  });

  for (const row of rows) {
    const values = columns.map((column) => column.value(row));
    const added = sheet.addRow(values.map((value) => (isDay(value) ? dayToDate(value.day) : value)));
    values.forEach((value, index) => {
      const cell = added.getCell(index + 1);
      if (isDay(value)) cell.numFmt = DAY_FORMAT;
      else if (columns[index].amount && value !== null) cell.numFmt = AMOUNT_FORMAT;
      if (columns[index].wrap) cell.alignment = { vertical: "top", wrapText: true };
    });
  }
  sheet.autoFilter = { from: { row: headerRows, column: 1 }, to: { row: headerRows, column: columns.length } };
  return sheet;
}

// A day is written as midnight UTC, and Excel counts days in UTC, so the calendar day stays the same.
const isDay = (value: CellValue): value is { day: string } => typeof value === "object" && value !== null;

export async function workbookBytes(workbook: ExcelJS.Workbook): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/**
 * The file as a download. The name may hold Sinhala letters: an ASCII stand-in, plus the real name
 * in UTF-8 (RFC 6266). Chrome saves a zero-width joiner in a file name as "_", so file names avoid
 * letters that need one, such as ප්‍ර. Nothing is cached, because the file holds personal details.
 */
export function xlsxResponse(bytes: Uint8Array<ArrayBuffer>, fileName: string, asciiName: string): Response {
  const disposition = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  return new Response(bytes, {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
