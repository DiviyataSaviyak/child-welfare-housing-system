import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { caseName } from "@/components/cases/page-header";
import { formatDate } from "@/lib/dates";
import { formatNumber } from "@/lib/money";
import { CATEGORIES, KINDS } from "@/lib/validation/case";
import { STALE_DAYS } from "@/server/cases/queries";
import { dashboard, type Figures, STALE_SHOWN, tableRows } from "@/server/dashboard/queries";
import { db } from "@/server/db";
import type { DistrictOptions } from "@/server/lists/queries";
import type { Viewer } from "@/server/permissions";

const oneOf = <T extends string>(list: readonly T[], value: string): T | undefined =>
  list.find((item) => item === value);

const selectClass = "h-11 min-w-56 rounded-lg border border-input bg-card px-3 text-base";
const COLUMNS = ["cases", "inProgress", "completed", "released", "paidOut"] as const satisfies (keyof Figures)[];

/**
 * DSH-1, DSH-2: the dashboard for the cases a viewer may see, as in the prototype. Totals, a table by
 * district that opens into its DS offices, and the cases waiting longest for an update. The filters
 * are in the address, so a view can be bookmarked or shared. Head Office's page adds its queues
 * (`side`); the view-only area's page offers only the districts of its area (PRM-4).
 */
export async function DashboardScreen({
  path,
  viewer,
  params,
  districts,
  oneDistrict = false,
  areaName,
  side,
}: {
  /** The dashboard's own address; its cases open under `${path}/cases`. */
  path: "/ministry" | "/oversight";
  viewer: Viewer;
  params: Record<string, string | string[] | undefined>;
  /** The districts the viewer may choose from, each with its DS offices. */
  districts: DistrictOptions[];
  /** The area is one district, or one DS office of it: no district filter, and the table lists its offices. */
  oneDistrict?: boolean;
  /** What the figures cover when no district is chosen, such as every district. */
  areaName: string;
  side?: React.ReactNode;
}) {
  const locale = await getLocale();
  const read = (key: string) => (typeof params[key] === "string" ? params[key] : "");
  // An area of one district has no district to choose: the table lists its DS offices.
  const district = oneDistrict ? districts[0] : districts.find((d) => String(d.id) === read("districtId"));
  const category = oneOf(CATEGORIES, read("category"));
  const kind = oneOf(KINDS, read("kind"));

  const [t, tc, data] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("cases"),
    dashboard(db, viewer, { districtId: district?.id, category, kind }, locale),
  ]);
  const rows = tableRows(districts, data.byOffice, district?.id);

  const href = (districtId: number | undefined) => {
    const query = new URLSearchParams();
    if (districtId && !oneDistrict) query.set("districtId", String(districtId));
    if (category) query.set("category", category);
    if (kind) query.set("kind", kind);
    const text = query.toString();
    return text ? `${path}?${text}` : path;
  };

  const scope = [
    district && !oneDistrict ? t("district", { district: district.name }) : areaName,
    category && tc(`category.${category}`),
    kind && tc(`kindShort.${kind}`),
    t("asOf", { date: formatDate(new Date()) }),
  ].filter(Boolean);

  const tiles = [
    { label: t("tiles.cases"), value: data.totals.cases, note: t("tiles.casesNote") },
    { label: t("tiles.inProgress"), value: data.totals.inProgress, note: t("tiles.inProgressNote") },
    { label: t("tiles.completed"), value: data.totals.completed, note: t("tiles.completedNote") },
    {
      label: t("tiles.released"),
      value: data.totals.released,
      note: t("tiles.releasedNote", { amount: formatNumber(data.totals.paidOut) }),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[28px] leading-snug font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{scope.join(" · ")}</p>
      </div>

      <form
        // The district links and the clear link change the address without leaving the page. A new
        // form shows the new choices; the old one would keep what its fields last held.
        key={`${district?.id}-${category}-${kind}`}
        method="get"
        action={path}
        aria-label={t("filters.label")}
        className="flex flex-wrap items-end gap-3 rounded-xl border bg-card px-5 py-4"
      >
        {!oneDistrict && (
          <Field id="districtId" label={t("filters.district")}>
            <select id="districtId" name="districtId" defaultValue={district?.id ?? ""} className={selectClass}>
              <option value="">{t("allDistricts")}</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field id="category" label={t("filters.category")}>
          <select id="category" name="category" defaultValue={category ?? ""} className={selectClass}>
            <option value="">{t("filters.all")}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tc(`category.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="kind" label={t("filters.kind")}>
          <select id="kind" name="kind" defaultValue={kind ?? ""} className={selectClass}>
            <option value="">{t("filters.all")}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {tc(`kindShort.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className="h-11 rounded-lg border border-primary px-5 font-semibold text-primary">
          {t("filters.apply")}
        </button>
        {((district && !oneDistrict) || category || kind) && (
          <Link href={path} className="flex h-11 items-center px-2 font-semibold text-primary underline">
            {t("filters.clear")}
          </Link>
        )}
      </form>

      <div className="flex items-start gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <dl aria-label={t("tiles.label")} className="grid grid-cols-4 gap-4">
            {tiles.map((tile) => (
              <div key={tile.label} className="flex flex-col gap-1 rounded-xl border bg-card px-4.5 py-4">
                <dt className="font-semibold text-[#3F4843]">{tile.label}</dt>
                <dd className="text-[26px] leading-tight font-bold tabular-nums">{formatNumber(tile.value)}</dd>
                <dd className="text-sm text-muted-foreground">{tile.note}</dd>
              </div>
            ))}
          </dl>

          <section aria-labelledby="table-title" className="overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
              <div className="flex flex-col gap-0.5">
                <h2 id="table-title" className="text-xl font-bold">
                  {district ? t("table.byOffice", { district: district.name }) : t("table.byDistrict")}
                </h2>
                {!district && <p className="text-[15px] text-muted-foreground">{t("table.hint")}</p>}
              </div>
              {district && !oneDistrict && (
                <Link
                  href={href(undefined)}
                  className="flex h-11 shrink-0 items-center rounded-lg border border-input px-4 font-semibold"
                >
                  ← {t("table.back")}
                </Link>
              )}
            </div>
            {/* Tamil and English headers are longer than Sinhala ones: the table scrolls rather than being cut off (UI-9). */}
            <div className="overflow-x-auto">
              <table aria-labelledby="table-title" className="w-full border-collapse text-left">
                <thead className="bg-muted/60 text-[15px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-semibold">
                      {district ? t("table.office") : t("table.district")}
                    </th>
                    {COLUMNS.map((column) => (
                      <th key={column} scope="col" className="px-3 py-2.5 text-right font-semibold last:pr-5">
                        {t(`table.${column}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr className="border-t">
                      <td colSpan={COLUMNS.length + 1} className="px-5 py-6 text-center text-muted-foreground">
                        {t("table.noOffices")}
                      </td>
                    </tr>
                  )}
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t hover:bg-accent/60">
                      <th scope="row" className="px-5 py-2.5 font-semibold">
                        {district ? (
                          row.active ? (
                            row.name
                          ) : (
                            tc("list.inactive", { office: row.name })
                          )
                        ) : (
                          <Link href={href(row.id)} className="text-primary underline underline-offset-3">
                            {row.name}
                          </Link>
                        )}
                      </th>
                      {COLUMNS.map((column) => (
                        <td
                          key={column}
                          className={`px-3 py-2.5 text-right tabular-nums last:pr-5 ${row[column] === 0 ? "text-muted-foreground" : ""}`}
                        >
                          {formatNumber(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/60 font-bold">
                  <tr>
                    <th scope="row" className="px-5 py-3">
                      {t("table.total")}
                    </th>
                    {COLUMNS.map((column) => (
                      <td key={column} className="px-3 py-3 text-right tabular-nums last:pr-5">
                        {formatNumber(data.totals[column])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>

        <div className="flex w-85 shrink-0 flex-col gap-5">
          {side}

          <section aria-labelledby="stale-title" className="flex flex-col gap-2 rounded-xl border bg-card px-5 py-4.5">
            <h2 id="stale-title" className="text-[19px] font-bold">
              {t("stale.title", { days: STALE_DAYS, count: formatNumber(data.stale.total) })}
            </h2>
            {data.stale.total === 0 ? (
              <p className="text-[15px] text-muted-foreground">{t("stale.none")}</p>
            ) : (
              <>
                <p className="text-[15px] text-muted-foreground">{t("stale.hint")}</p>
                <table aria-labelledby="stale-title" className="w-full border-collapse text-left">
                  <thead className="text-sm text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-1.5 font-semibold">
                        {t("stale.beneficiary")}
                      </th>
                      <th scope="col" className="py-1.5 text-right font-semibold">
                        {t("stale.days")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stale.cases.map((c) => (
                      <tr key={c.id} className="border-t align-top">
                        <td className="py-2 pr-3">
                          <Link href={`${path}/cases/${c.id}`} className="flex flex-col">
                            <span className="font-semibold text-primary underline-offset-2 hover:underline">
                              {caseName(tc, c.name, c.childName)}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {c.caseNumber ?? tc("noNumber")} ·{" "}
                              {t("stale.place", { office: c.officeName, district: c.districtName })}
                            </span>
                          </Link>
                        </td>
                        <td className="py-2 text-right text-lg font-bold text-[#8A4A06] tabular-nums">
                          {formatNumber(c.days)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.stale.total > STALE_SHOWN && (
                  <p className="text-sm text-muted-foreground">{t("stale.shown", { shown: STALE_SHOWN })}</p>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[15px] font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}
