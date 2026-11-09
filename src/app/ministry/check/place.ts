import type { QueuePlace } from "@/server/cases/queues";
import type { DistrictOptions } from "@/server/lists/queries";
import { positive } from "@/components/cases/list-filters";

/** A district or DS office to narrow a queue to, with how many cases wait there (CHK-4). */
export type PlaceChoice = { id: number; name: string; count: number; active: boolean };
export type DistrictChoice = PlaceChoice & { offices: PlaceChoice[] };

/** The place from the address, or from a decision's form so the next page keeps it. */
export function readPlace(read: (key: string) => string): QueuePlace {
  return { districtId: positive(read("districtId")), dsOfficeId: positive(read("dsOfficeId")) };
}

/** The place as an address query: the district first, then the office. */
export function placeQuery(place: QueuePlace): URLSearchParams {
  const query = new URLSearchParams();
  if (place.districtId) query.set("districtId", String(place.districtId));
  if (place.dsOfficeId) query.set("dsOfficeId", String(place.dsOfficeId));
  return query;
}

/**
 * CHK-4: the districts and DS offices Head Office can narrow a queue to, each with how many cases
 * wait there. Only places with cases waiting are offered, and the chosen ones even once none are
 * left, so the officer sees where they are. A chosen office brings its own district; a place that
 * doesn't exist is dropped.
 */
export function placeChoices(
  districts: DistrictOptions[],
  waiting: Map<number, number>,
  asked: QueuePlace,
): { place: QueuePlace; districts: DistrictChoice[] } {
  const home = asked.dsOfficeId ? districts.find((d) => d.offices.some((o) => o.id === asked.dsOfficeId)) : undefined;
  const place: QueuePlace = home
    ? { districtId: home.id, dsOfficeId: asked.dsOfficeId }
    : { districtId: districts.some((d) => d.id === asked.districtId) ? asked.districtId : undefined };

  const choices = districts.map((d) => {
    const offices = d.offices.map((o) => ({ id: o.id, name: o.name, active: o.active, count: waiting.get(o.id) ?? 0 }));
    return {
      id: d.id,
      name: d.name,
      active: true,
      count: offices.reduce((sum, o) => sum + o.count, 0),
      offices: offices.filter((o) => o.count > 0 || o.id === place.dsOfficeId),
    };
  });
  return { place, districts: choices.filter((d) => d.count > 0 || d.id === place.districtId) };
}
