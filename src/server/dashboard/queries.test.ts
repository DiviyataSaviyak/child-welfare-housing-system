import { describe, expect, it } from "vitest";
import type { DistrictOptions } from "../lists/queries";
import { type Figures, noFigures, tableRows } from "./queries";

const districts: DistrictOptions[] = [
  {
    id: 1,
    name: "කොළඹ",
    offices: [
      { id: 10, name: "හෝමාගම", active: true },
      { id: 11, name: "මහරගම", active: true },
      { id: 12, name: "පැරණි කාර්යාලය", active: false },
      { id: 13, name: "වසා දැමූ කාර්යාලය", active: false },
    ],
  },
  { id: 2, name: "ගම්පහ", offices: [{ id: 20, name: "ගම්පහ", active: true }] },
  { id: 3, name: "කළුතර", offices: [] },
];

/** An office's figures from its cases in each status, with the money each status has. */
const of = (awaiting: number, inProgress = 0, completed = 0, allocatedToDistrict = 0, received = 0): Figures => ({
  cases: awaiting + allocatedToDistrict + received + inProgress + completed,
  awaiting,
  allocatedToDistrict,
  received,
  inProgress,
  completed,
  allocated: (allocatedToDistrict + received + inProgress + completed) * 2_000_000,
  releasedToDs: (received + inProgress + completed) * 2_000_000,
  paidOut: completed * 2_000_000,
});

const byOffice = new Map<number, Figures>([
  [10, of(1, 3, 1)],
  [11, of(0, 1, 0, 1)],
  [12, of(0, 0, 1)],
  [20, of(0, 4, 0, 0, 1)],
]);

describe("the dashboard table (DSH-1)", () => {
  it("shows every district, with or without cases, adding up its offices", () => {
    const rows = tableRows(districts, byOffice);
    expect(rows.map((r) => [r.name, r.cases, r.inProgress, r.completed])).toEqual([
      ["කොළඹ", 8, 4, 2],
      ["ගම්පහ", 5, 4, 0],
      ["කළුතර", 0, 0, 0],
    ]);
    expect(rows.map((r) => [r.awaiting, r.allocatedToDistrict, r.received])).toEqual([
      [1, 1, 0],
      [0, 0, 1],
      [0, 0, 0],
    ]);
    expect(rows.map((r) => [r.allocated, r.releasedToDs, r.paidOut])).toEqual([
      [14_000_000, 12_000_000, 4_000_000],
      [10_000_000, 10_000_000, 0],
      [0, 0, 0],
    ]);
  });

  it("opens a district into its DS offices, showing an inactive one only while it has cases", () => {
    const rows = tableRows(districts, byOffice, 1);
    expect(rows.map((r) => [r.id, r.active, r.cases])).toEqual([
      [10, true, 5],
      [11, true, 2],
      [12, false, 1],
    ]);
    expect(tableRows(districts, new Map(), 2)).toEqual([{ id: 20, name: "ගම්පහ", active: true, ...noFigures() }]);
  });

  it("has no rows for a district without offices or one it doesn't know", () => {
    expect(tableRows(districts, byOffice, 3)).toEqual([]);
    expect(tableRows(districts, byOffice, 99)).toEqual([]);
  });
});
