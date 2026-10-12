import { ArrowRightLeft, CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { caseFieldRows, DocumentLinks, ReplacementNotes } from "@/components/cases/case-view";
import { caseName } from "@/components/cases/page-header";
import { Pager } from "@/components/cases/pager";
import { DecisionPanel } from "@/components/review/decision-panel";
import { DuplicateCases } from "@/components/review/duplicate-cases";
import { LetterForm, type LetterFormGroup } from "@/components/review/letter-form";
import { LetterNotice, ReviewNotice } from "@/components/review/review-notice";
import { colomboDay, daysBetween, formatDate } from "@/lib/dates";
import { formatRupees, RELEASE_AMOUNT } from "@/lib/money";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { duplicatesInFull } from "@/server/cases/duplicates";
import { getCase, PAGE_SIZE } from "@/server/cases/queries";
import { listQueue, type Queue, queueByOffice, type QueuePlace, queueCounts } from "@/server/cases/queues";
import { districtsWithOffices } from "@/server/lists/queries";
import type { Viewer } from "@/server/permissions";
import { casesForLetter, districtsWaiting, getLetter, recentLetters } from "@/server/releases/queries";
import { decideAction, recordLetterAction, uploadLetterScanAction } from "./actions";
import { placeChoices, placeQuery, readPlace } from "./place";
import { PlacePicker } from "./place-picker";

export type ReviewSearchParams = Promise<{
  case?: string | string[];
  page?: string | string[];
  notice?: string | string[];
  done?: string | string[];
  districtId?: string | string[];
  dsOfficeId?: string | string[];
  letter?: string | string[];
}>;

type Params = Awaited<ReviewSearchParams>;

const QUEUES: Queue[] = ["check", "release"];

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
const queueHref = (path: string, query: URLSearchParams) => (query.size > 0 ? `${path}?${query}` : path);

/**
 * "පරීක්ෂා කිරීම සහ ප්‍රතිපාදන මුදා හැරීම" as in the prototype (UI-7, option A): two tabs. /ho/check
 * (CHK-1) checks one case at a time; /ho/release (REL-1, REL-2) records each district's allocation
 * letter for its verified cases.
 */
export async function ReviewScreen({ queue, searchParams }: { queue: Queue; searchParams: ReviewSearchParams }) {
  const viewer = await requireRole("HO_OFFICER");
  const params = await searchParams;
  return queue === "check" ? (
    <CheckTab viewer={viewer} params={params} />
  ) : (
    <LetterTab viewer={viewer} params={params} />
  );
}

/** The screen's title, the notice of what was just done, and the two tabs, which keep the place (CHK-4). */
async function ReviewFrame({
  queue,
  counts,
  tabPlace,
  notice,
  children,
}: {
  queue: Queue;
  counts: Record<Queue, number>;
  tabPlace: QueuePlace;
  notice: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = await getTranslations("review");
  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[28px] leading-snug font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </div>

      {notice}

      <nav aria-label={t("tabsLabel")} className="flex gap-3">
        {QUEUES.map((key) => (
          <Link
            key={key}
            href={queueHref(`/ho/${key}`, placeQuery(tabPlace))}
            aria-current={key === queue ? "page" : undefined}
            className={`flex h-12.5 items-center rounded-lg border-2 px-5.5 text-[17px] font-bold ${
              key === queue ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"
            }`}
          >
            {t(`tabs.${key}`, { count: counts[key] })}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}

/**
 * Tab 1 (CHK-1 to CHK-4): the queue is on the left, longest waiting first; the chosen case is on the
 * right, with every field, its documents and NIC matches (CHK-2), and the decision (CHK-3). Above them,
 * the queue can be narrowed to a district or one DS office (CHK-4). Once a district has nothing left
 * to check but has verified cases waiting, a banner leads to its letter on tab 2, as in the prototype.
 */
async function CheckTab({ viewer, params }: { viewer: Viewer; params: Params }) {
  const page = Math.max(1, Number(params.page) || 1);
  const asked = readPlace((key) => one(params[key as "districtId" | "dsOfficeId"]) ?? "");

  const locale = await getLocale();
  const [t, tc, counts, districts, waiting, verified] = await Promise.all([
    getTranslations("review"),
    getTranslations("cases"),
    queueCounts(db, viewer),
    districtsWithOffices(db, locale),
    queueByOffice(db, viewer, "check"),
    queueByOffice(db, viewer, "release"),
  ]);
  const places = placeChoices(districts, waiting, asked);
  const { place } = places;
  const list = await listQueue(db, viewer, "check", page, locale, place);
  const wanted = one(params.case);
  const selectedId = list.rows.find((row) => row.id === wanted)?.id ?? list.rows[0]?.id ?? null;
  const done = one(params.done);
  const [details, doneDetails] = await Promise.all([
    selectedId ? getCase(db, viewer, selectedId, locale) : null,
    done ? getCase(db, viewer, done, locale) : null,
  ]);
  const duplicates = details
    ? await duplicatesInFull(
        db,
        viewer,
        { caseId: details.id, nic: details.nic, dsOfficeId: details.dsOfficeId },
        locale,
      )
    : [];

  const now = new Date();
  const placeHref = (at: QueuePlace) => queueHref("/ho/check", placeQuery(at));
  const href = (changes: { case?: string; page?: number }) => {
    const query = placeQuery(place);
    const nextPage = changes.page ?? page;
    if (nextPage > 1) query.set("page", String(nextPage));
    if (changes.case) query.set("case", changes.case);
    return queueHref("/ho/check", query);
  };

  const district = places.districts.find((d) => d.id === place.districtId);
  const option = (name: string, count: number, active = true) =>
    t(active ? "place.option" : "place.inactive", { name, count });
  const picker = {
    districts: [
      { href: placeHref({}), label: t("place.allDistricts", { count: counts.check }) },
      ...places.districts.map((d) => ({ href: placeHref({ districtId: d.id }), label: option(d.name, d.count) })),
    ],
    offices: district
      ? [
          { href: placeHref({ districtId: district.id }), label: t("place.allOffices", { count: district.count }) },
          ...district.offices.map((o) => ({
            href: placeHref({ districtId: district.id, dsOfficeId: o.id }),
            label: option(o.name, o.count, o.active),
          })),
        ]
      : [],
  };

  // The chosen district, or the one of the case just verified: nothing left to check there, but
  // verified cases waiting for its letter.
  const hintId = place.districtId ?? (params.notice === "verified" ? doneDetails?.districtId : undefined);
  const hintDistrict = districts.find((d) => d.id === hintId);
  const inDistrict = (counted: Map<number, number>) =>
    hintDistrict?.offices.reduce((sum, o) => sum + (counted.get(o.id) ?? 0), 0) ?? 0;
  const hint = hintDistrict &&
    inDistrict(waiting) === 0 &&
    inDistrict(verified) > 0 && {
      id: hintDistrict.id,
      text: t("letters.hint", {
        district: hintDistrict.name,
        count: inDistrict(verified),
        amount: formatRupees(inDistrict(verified) * RELEASE_AMOUNT, locale),
      }),
    };

  return (
    <ReviewFrame
      queue="check"
      counts={counts}
      tabPlace={place}
      notice={<ReviewNotice notice={params.notice} details={doneDetails} />}
    >
      <PlacePicker
        // A new place from the address shows its own choices.
        key={placeHref(place)}
        districts={picker.districts}
        offices={picker.offices}
        district={placeHref({ districtId: place.districtId })}
        office={placeHref(place)}
        clear={place.districtId ? placeHref({}) : null}
      />

      {hint && (
        <div className="flex items-center gap-4 rounded-xl border-[1.5px] border-primary bg-accent px-4.5 py-3.5 text-accent-foreground">
          <CircleCheck aria-hidden="true" className="size-6.5 shrink-0" />
          <span className="flex-1">{hint.text}</span>
          <Link
            href={`/ho/release?districtId=${hint.id}`}
            className="flex h-11.5 shrink-0 items-center rounded-lg bg-primary px-4.5 font-bold text-primary-foreground"
          >
            {t("letters.hintGo")}
          </Link>
        </div>
      )}

      <div className="flex items-start gap-6">
        <section aria-labelledby="queue-title" className="flex w-[400px] shrink-0 flex-col gap-2.5">
          <h2 id="queue-title" className="sr-only">
            {t("listLabel.check")}
          </h2>
          {list.rows.length === 0 ? (
            <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">
              {t(place.districtId ? "emptyHere.check" : "empty.check")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {list.rows.map((row) => {
                const selected = row.id === selectedId;
                return (
                  <li key={row.id}>
                    <Link
                      href={href({ case: row.id })}
                      aria-current={selected ? "true" : undefined}
                      className={`flex flex-col gap-0.5 rounded-xl border-2 px-4 py-3.5 ${
                        selected ? "border-primary bg-accent" : "border-border bg-card hover:border-primary/60"
                      }`}
                    >
                      <span className="text-[17px] font-bold">{caseName(tc, row.name, row.childName)}</span>
                      <span className="text-[15px] text-muted-foreground">
                        {t("rowOffice", { number: row.caseNumber ?? tc("noNumber"), office: row.officeName })}
                      </span>
                      {row.waitingSince && (
                        <span className="text-sm text-[#3F4843]">
                          {t("waiting.check", {
                            date: formatDate(row.waitingSince),
                            days: daysBetween(row.waitingSince, now),
                          })}
                        </span>
                      )}
                      {row.duplicate && (
                        <span className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-[#8A4A06]">
                          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
                          {t("duplicateFlag")}
                        </span>
                      )}
                      {row.replacesNumber && (
                        <span className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-primary">
                          <ArrowRightLeft aria-hidden="true" className="size-4 shrink-0" />
                          {t("replacesFlag", { number: row.replacesNumber })}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={list.total} href={(p) => href({ page: p })} />
        </section>

        {details && (
          <section
            aria-labelledby="case-title"
            className="flex min-w-0 flex-1 flex-col gap-4.5 rounded-xl border bg-card px-6.5 py-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <h2 id="case-title" className="text-2xl font-bold">
                  {caseName(tc, details.name, details.childName)}
                </h2>
                <p className="text-muted-foreground">
                  {t("subtitle", {
                    number: details.caseNumber ?? tc("noNumber"),
                    office: details.officeName,
                    district: details.districtName,
                  })}
                </p>
              </div>
              <Link href={`/ho/cases/${details.id}`} className="shrink-0 font-semibold text-primary underline">
                {t("openCase")}
              </Link>
            </div>

            <ReplacementNotes details={details} audience="ho" />
            <DuplicateCases matches={duplicates} />

            <dl className="grid grid-cols-[250px_minmax(0,1fr)] gap-x-4 gap-y-2.5">
              {caseFieldRows(tc, details).map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="font-semibold break-words whitespace-pre-line">{row.value}</dd>
                </div>
              ))}
            </dl>

            <section aria-labelledby="check-documents-title" className="flex flex-col gap-2">
              <h3 id="check-documents-title" className="text-lg font-bold">
                {t("documents")}{" "}
                <span className="text-[15px] font-normal text-muted-foreground">{t("opensInNewTab")}</span>
              </h3>
              <DocumentLinks documents={details.documents} empty={t("noDocuments")} />
            </section>

            <DecisionPanel
              key={`${details.id}-${details.version}`}
              caseId={details.id}
              version={details.version}
              from="queue"
              place={place}
              caseLabel={{
                name: caseName(tc, details.name, details.childName),
                number: details.caseNumber ?? tc("noNumber"),
              }}
              action={decideAction}
            />
          </section>
        )}
      </div>
    </ReviewFrame>
  );
}

/**
 * Tab 2 (REL-1, REL-2), as in the prototype: Head Office releases money by one allocation letter to a
 * District Secretary for several verified cases of the district. On the left, the districts whose
 * verified cases wait for a letter, and the letters recorded last; on the right, the chosen district's
 * letter (`?districtId=`, or the first district waiting).
 */
async function LetterTab({ viewer, params }: { viewer: Viewer; params: Params }) {
  const asked = readPlace((key) => one(params[key as "districtId" | "dsOfficeId"]) ?? "");
  const letterId = params.notice === "letterRecorded" ? one(params.letter) : null;

  const locale = await getLocale();
  const [t, tc, counts, districts, letters, recorded] = await Promise.all([
    getTranslations("review"),
    getTranslations("cases"),
    queueCounts(db, viewer),
    districtsWaiting(db, viewer, locale),
    recentLetters(db, viewer, locale),
    letterId && letterId.length <= 64 ? getLetter(db, viewer, letterId, locale) : null,
  ]);
  const chosen = districts.find((d) => d.id === asked.districtId) ?? districts[0] ?? null;
  const cases = chosen ? await casesForLetter(db, viewer, chosen.id, locale) : [];

  const now = new Date();
  const groups: LetterFormGroup[] = [];
  for (const c of cases) {
    let group = groups.at(-1);
    if (group?.office !== c.officeName) groups.push((group = { office: c.officeName, cases: [] }));
    const number = c.caseNumber ?? tc("noNumber");
    group.cases.push({
      id: c.id,
      version: c.version,
      name: caseName(tc, c.name, c.childName),
      detail:
        c.verifiedAt && daysBetween(c.verifiedAt, now) > 0
          ? t("letters.verifiedOn", { number, date: formatDate(c.verifiedAt) })
          : t("letters.verifiedToday", { number }),
      verifiedOn: c.verifiedAt && colomboDay(c.verifiedAt),
    });
  }

  return (
    <ReviewFrame queue="release" counts={counts} tabPlace={asked} notice={<LetterNotice letter={recorded} />}>
      <div className="flex items-start gap-6">
        <div className="flex w-[400px] shrink-0 flex-col gap-4.5">
          <section aria-labelledby="waiting-title" className="flex flex-col gap-2.5">
            <h2 id="waiting-title" className="text-[17px] font-bold text-[#3F4843]">
              {t("letters.waitingTitle")}
            </h2>
            {districts.length === 0 ? (
              <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">{t("letters.none")}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {districts.map((d) => {
                  const selected = d.id === chosen?.id;
                  return (
                    <li key={d.id}>
                      <Link
                        href={`/ho/release?districtId=${d.id}`}
                        aria-current={selected ? "true" : undefined}
                        className={`flex flex-col gap-0.5 rounded-xl border-2 px-4 py-3.5 ${
                          selected ? "border-primary bg-accent" : "border-border bg-card hover:border-primary/60"
                        }`}
                      >
                        <span className="text-[17px] font-bold">{t("letters.district", { name: d.name })}</span>
                        <span className="text-[15px] font-semibold">
                          {t("letters.districtCount", {
                            count: d.count,
                            amount: formatRupees(d.count * RELEASE_AMOUNT, locale),
                          })}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {t("letters.districtOffices", { offices: d.offices.join(", ") })}
                        </span>
                        {d.oldest && (
                          <span className="text-sm text-[#3F4843]">
                            {t("letters.oldest", { days: daysBetween(d.oldest, now) })}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="letters-title"
            className="flex flex-col gap-1 rounded-xl border bg-card px-4.5 py-4"
          >
            <h2 id="letters-title" className="mb-1 text-[17px] font-bold">
              {t("letters.recordedTitle")}
            </h2>
            {letters.length === 0 ? (
              <p className="text-[15px] text-muted-foreground">{t("letters.recordedNone")}</p>
            ) : (
              <ul className="flex flex-col">
                {letters.map((letter) => (
                  <li key={letter.id} className="flex flex-col border-t py-2">
                    <span className="text-[15px] font-bold">
                      {t("letters.recordedName", { district: letter.districtName, number: letter.letterNumber })}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t("letters.recordedSub", {
                        date: formatDate(letter.letterDate),
                        count: letter.count,
                        amount: formatRupees(letter.count * RELEASE_AMOUNT, locale),
                      })}
                    </span>
                    <span className="text-sm text-[#3F4843]">
                      {t("letters.recordedUntil", { date: formatDate(letter.validUntil) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {chosen && cases.length > 0 && (
          <section
            aria-labelledby="letter-title"
            className="flex min-w-0 flex-1 flex-col gap-4.5 rounded-xl border bg-card px-6.5 py-6"
          >
            <div className="flex flex-col gap-0.5">
              <h2 id="letter-title" className="text-2xl font-bold">
                {t("letters.title", { district: chosen.name })}
              </h2>
              <p className="text-muted-foreground">{t("letters.intro", { district: chosen.name })}</p>
            </div>
            <LetterForm
              // A case that changed or left the list starts the form again.
              key={`${chosen.id}:${cases.map((c) => `${c.id}.${c.version}`).join(",")}`}
              districtId={chosen.id}
              groups={groups}
              today={colomboDay(now)}
              action={recordLetterAction}
              upload={uploadLetterScanAction}
            />
          </section>
        )}
      </div>
    </ReviewFrame>
  );
}
