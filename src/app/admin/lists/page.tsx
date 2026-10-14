import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Kind } from "@/generated/prisma/enums";
import { localName, type Names } from "@/lib/names";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { listDistricts, officesOfDistrict, stagesByKind } from "@/server/lists/queries";
import {
  addOfficeAction,
  addStageAction,
  moveStageAction,
  renameOfficeAction,
  renameStageAction,
  setOfficeActiveAction,
  setStageActiveAction,
} from "./actions";
import { AddOfficeForm, AddStageForm, RenameInPlace } from "./list-forms";

const smallButton = "h-10 rounded-lg border px-3 text-[15px] font-semibold";

/** The three names of an office or stage row, for its rename form. */
const namesOf = ({ nameSi, nameTa, nameEn }: Names): Names => ({ nameSi, nameTa, nameEn });

export default async function AdminListsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; district?: string | string[] }>;
}) {
  await requireRole("ADMIN");
  const params = await searchParams;
  const tab = params.tab === "stages" ? "stages" : "places";
  const t = await getTranslations("lists");

  const tabs = [
    { key: "places", href: "/admin/lists", label: t("tabs.places") },
    { key: "stages", href: "/admin/lists?tab=stages", label: t("tabs.stages") },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[28px] leading-snug font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </div>
      <nav aria-label={t("tabs.label")} className="flex gap-3">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={tab === item.key ? "page" : undefined}
            className={`flex h-12 items-center rounded-lg border-2 px-5 text-[17px] font-bold ${
              tab === item.key ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {tab === "places" ? <Places districtParam={params.district} /> : <Stages />}
    </div>
  );
}

async function Places({ districtParam }: { districtParam?: string | string[] }) {
  const [t, locale] = await Promise.all([getTranslations("lists"), getLocale()]);
  const districts = await listDistricts(db, locale);
  const selectedId = Number(typeof districtParam === "string" ? districtParam : districts[0]?.id);
  const selected = Number.isInteger(selectedId) ? await officesOfDistrict(db, selectedId, locale) : null;

  return (
    <div className="flex items-start gap-6">
      <section
        aria-labelledby="districts-title"
        className="w-[360px] shrink-0 overflow-hidden rounded-xl border bg-card"
      >
        <h2 id="districts-title" className="border-b px-5 py-3.5 text-lg font-bold">
          {t("districts", { count: districts.length })}
        </h2>
        <ul className="max-h-[600px] overflow-y-auto">
          {districts.map((d) => {
            const current = selected?.district.id === d.id;
            return (
              <li key={d.id}>
                <Link
                  href={`/admin/lists?district=${d.id}`}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-13 items-center justify-between gap-3 border-b border-l-4 px-4 py-2 ${
                    current ? "border-l-primary bg-accent font-bold" : "border-l-transparent"
                  }`}
                >
                  <span className="flex flex-col">
                    <span className="text-base">{d.name}</span>
                    <span className="text-[13px] font-normal text-muted-foreground">
                      {t("province", { province: d.province })}
                    </span>
                  </span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {t("officeCount", { count: d.offices })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {selected && (
        <section
          aria-labelledby="offices-title"
          className="flex min-w-0 flex-1 flex-col gap-5 rounded-xl border bg-card p-6"
        >
          <div className="flex flex-col gap-0.5">
            <h2 id="offices-title" className="text-[22px] font-bold">
              {t("districtTitle", { district: selected.district.name })}
            </h2>
            <p className="text-[15px] text-muted-foreground">
              {t("districtSubtitle", { province: selected.district.province, count: selected.offices.length })}
            </p>
          </div>

          <table className="w-full border-collapse text-left">
            <thead className="bg-muted/60 text-[15px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  {t("columns.office")}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t("columns.code")}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t("columns.officers")}
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  {t("columns.status")}
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  {t("columns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {selected.offices.map((o) => (
                <tr key={o.id} className="border-t align-top">
                  <td className="px-4 py-2.5 font-semibold">{localName(o, locale)}</td>
                  <td className="px-3 py-2.5 font-mono">{o.code}</td>
                  <td
                    className={`px-3 py-2.5 text-[15px] ${o.officers.length === 0 && o.active ? "font-semibold text-notice-foreground" : ""}`}
                  >
                    {o.officers.length === 0 ? t("noAccount") : o.officers.map((name, i) => <div key={i}>{name}</div>)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block rounded-full px-3 py-0.5 text-sm font-semibold ${o.active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}
                    >
                      {o.active ? t("active") : t("inactive")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap justify-end gap-2">
                      <RenameInPlace
                        id={`rename-office-${o.id}`}
                        label={t("renameLabel", { name: localName(o, locale) })}
                        action={renameOfficeAction.bind(null, o.id)}
                        names={namesOf(o)}
                      />
                      <form action={setOfficeActiveAction.bind(null, o.id, !o.active)}>
                        <button
                          type="submit"
                          aria-label={
                            o.active
                              ? t("deactivateLabel", { name: localName(o, locale) })
                              : t("activateLabel", { name: localName(o, locale) })
                          }
                          className={`${smallButton} ${o.active ? "border-destructive text-destructive" : "border-primary text-primary"}`}
                        >
                          {o.active ? t("deactivate") : t("activate")}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-col gap-3 border-t pt-5">
            <h3 className="text-lg font-bold">{t("addOffice")}</h3>
            <AddOfficeForm key={selected.district.id} action={addOfficeAction.bind(null, selected.district.id)} />
          </div>
          <p className="text-sm text-muted-foreground">{t("neverDeleted")}</p>
        </section>
      )}
    </div>
  );
}

async function Stages() {
  const [t, locale] = await Promise.all([getTranslations("lists"), getLocale()]);
  const stages = await stagesByKind(db);

  return (
    <div className="grid grid-cols-2 items-start gap-6">
      {Object.values(Kind).map((kind) => (
        <section
          key={kind}
          aria-labelledby={`stages-${kind}`}
          className="flex flex-col gap-4 rounded-xl border bg-card p-6"
        >
          <div className="flex flex-col gap-0.5">
            <h2 id={`stages-${kind}`} className="text-[21px] font-bold">
              {t(`kinds.${kind}`)}
            </h2>
            <p className="text-[15px] text-muted-foreground">{t(`kindHints.${kind}`)}</p>
          </div>

          {stages[kind].length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-5 text-center text-muted-foreground">
              {t("noStages")}
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {stages[kind].map((stage, index, all) => (
                <li key={stage.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
                  <span
                    aria-hidden="true"
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${stage.active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {index + 1}
                  </span>
                  <span className={`flex-1 font-semibold ${stage.active ? "" : "text-muted-foreground line-through"}`}>
                    {localName(stage, locale)}
                  </span>
                  {!stage.active && <span className="text-sm text-muted-foreground">{t("inactive")}</span>}
                  <form action={moveStageAction.bind(null, stage.id, "up")}>
                    <button
                      type="submit"
                      disabled={index === 0}
                      aria-label={t("moveUp", { name: localName(stage, locale) })}
                      className={`${smallButton} border-input disabled:opacity-40`}
                    >
                      ↑
                    </button>
                  </form>
                  <form action={moveStageAction.bind(null, stage.id, "down")}>
                    <button
                      type="submit"
                      disabled={index === all.length - 1}
                      aria-label={t("moveDown", { name: localName(stage, locale) })}
                      className={`${smallButton} border-input disabled:opacity-40`}
                    >
                      ↓
                    </button>
                  </form>
                  <RenameInPlace
                    id={`rename-stage-${stage.id}`}
                    label={t("renameLabel", { name: localName(stage, locale) })}
                    action={renameStageAction.bind(null, stage.id)}
                    names={namesOf(stage)}
                    width="w-72"
                  />
                  <form action={setStageActiveAction.bind(null, stage.id, !stage.active)}>
                    <button
                      type="submit"
                      aria-label={
                        stage.active
                          ? t("deactivateLabel", { name: localName(stage, locale) })
                          : t("activateLabel", { name: localName(stage, locale) })
                      }
                      className={`${smallButton} ${stage.active ? "border-destructive text-destructive" : "border-primary text-primary"}`}
                    >
                      {stage.active ? t("deactivate") : t("activate")}
                    </button>
                  </form>
                </li>
              ))}
            </ol>
          )}

          <div className="flex flex-col gap-2 border-t pt-4">
            <h3 className="text-base font-bold">{t("newStage")}</h3>
            <AddStageForm id={`add-stage-${kind}`} action={addStageAction.bind(null, kind)} />
          </div>
          <p className="text-sm text-muted-foreground">{t("stageNote")}</p>
        </section>
      ))}
    </div>
  );
}
