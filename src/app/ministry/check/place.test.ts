import { describe, expect, it } from "vitest";
import type { DistrictOptions } from "@/server/lists/queries";
import { placeChoices, placeQuery, readPlace } from "./place";

const districts: DistrictOptions[] = [
  {
    id: 1,
    name: "කොළඹ",
    offices: [
      { id: 10, name: "හෝමාගම", active: true },
      { id: 11, name: "කඩුවෙල", active: true },
      { id: 12, name: "මහරගම", active: false },
    ],
  },
  { id: 2, name: "ගම්පහ", offices: [{ id: 20, name: "මීගමුව", active: true }] },
  { id: 3, name: "කළුතර", offices: [{ id: 30, name: "පානදුර", active: true }] },
];

const reader = (values: Record<string, string>) => (key: string) => values[key] ?? "";

describe("the place a queue is narrowed to (CHK-4)", () => {
  it("reads whole positive numbers only, and writes the district before the office", () => {
    expect(readPlace(reader({ districtId: "1", dsOfficeId: "10" }))).toEqual({ districtId: 1, dsOfficeId: 10 });
    expect(readPlace(reader({ districtId: "0", dsOfficeId: "1.5" }))).toEqual({});
    expect(readPlace(reader({ districtId: "x", dsOfficeId: "-3" }))).toEqual({});
    expect(placeQuery({ dsOfficeId: 10, districtId: 1 }).toString()).toBe("districtId=1&dsOfficeId=10");
    expect(placeQuery({}).toString()).toBe("");
  });

  it("offers only districts and offices with cases waiting, each with its count", () => {
    const { place, districts: choices } = placeChoices(
      districts,
      new Map([
        [10, 3],
        [11, 1],
        [30, 2],
      ]),
      {},
    );
    expect(place).toEqual({ districtId: undefined });
    expect(choices.map((d) => [d.name, d.count])).toEqual([
      ["කොළඹ", 4],
      ["කළුතර", 2],
    ]);
    expect(choices[0]?.offices.map((o) => [o.name, o.count])).toEqual([
      ["හෝමාගම", 3],
      ["කඩුවෙල", 1],
    ]);
  });

  it("keeps the chosen district and office even once nothing waits there", () => {
    const { place, districts: choices } = placeChoices(districts, new Map([[30, 2]]), {
      districtId: 1,
      dsOfficeId: 11,
    });
    expect(place).toEqual({ districtId: 1, dsOfficeId: 11 });
    expect(choices.map((d) => d.name)).toEqual(["කොළඹ", "කළුතර"]);
    expect(choices[0]?.offices).toEqual([{ id: 11, name: "කඩුවෙල", active: true, count: 0 }]);
  });

  it("takes a chosen office's own district, and drops a place that doesn't exist", () => {
    const waiting = new Map([[12, 1]]);
    expect(placeChoices(districts, waiting, { districtId: 2, dsOfficeId: 12 }).place).toEqual({
      districtId: 1,
      dsOfficeId: 12,
    });
    expect(placeChoices(districts, waiting, { dsOfficeId: 12 }).place).toEqual({ districtId: 1, dsOfficeId: 12 });
    expect(placeChoices(districts, waiting, { districtId: 99, dsOfficeId: 999 }).place).toEqual({
      districtId: undefined,
    });
    // An inactive office still holding a case is offered, marked inactive.
    expect(placeChoices(districts, waiting, {}).districts[0]?.offices).toEqual([
      { id: 12, name: "මහරගම", active: false, count: 1 },
    ]);
  });
});
