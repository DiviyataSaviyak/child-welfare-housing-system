import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { caseName } from "@/components/cases/page-header";
import { positive } from "@/components/cases/list-filters";
import { LetterForm, type LetterFormGroup } from "@/components/review/letter-form";
import { LetterNotice } from "@/components/review/review-notice";
import { colomboDay, daysBetween, formatDate } from "@/lib/dates";
import { formatRupees, RELEASE_AMOUNT } from "@/lib/money";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { SentCases } from "@/components/review/sent-cases";
import { SentPopup } from "@/components/review/sent-popup";
import { casesForLetter, districtsWaiting, getLetter, letterWithCases, recentLetters } from "@/server/releases/queries";
import { recordLetterAction, uploadLetterScanAction } from "./actions";
import { AllocateFilters } from "./allocate-filters";
import { allocateHref } from "./href";

type SearchParams = Promise<{
  notice?: string | string[];
  districtId?: string | string[];
  dsOfficeId?: string | string[];
  letter?: string | string[];
  open?: string | string[];
}>;

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

/**
 * REL-1, REL-2, as in the prototype's release tab: the Ministry allocates money by one allocation letter to
 * a District Secretary for several cases of the district awaiting their allocation; the District then
 * releases it to the DS offices (REL-6). On the left, the districts whose cases wait for a letter, and the
 * letters recorded last; on the right, the chosen district's letter (`?districtId=`, or the first
 * district waiting), with nothing ticked to start with, since the Ministry chooses whom it funds. Above the
 * districts, the district and DS office drop-downs; with a DS office chosen (`?dsOfficeId=`, one of the
 * district's offices waiting), the letter lists only its cases.
 */
export default async function MinistryAllocatePage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireRole("MINISTRY_OFFICER");
  const params = await searchParams;
  const askedId = positive(one(params.districtId) ?? "");
  const letterId = params.notice === "letterRecorded" ? one(params.letter) : null;
  const openId = one(params.open);

  const locale = await getLocale();
  const [t, tc, districts, letters, recorded, opened] = await Promise.all([
    getTranslations("review"),
    getTranslations("cases"),
    districtsWaiting(db, viewer, locale),
    recentLetters(db, viewer, locale),
    letterId && letterId.length <= 64 ? getLetter(db, viewer, letterId, locale) : null,
    openId && openId.length <= 64 ? letterWithCases(db, viewer, openId, locale) : null,
  ]);
  const chosen = districts.find((d) => d.id === askedId) ?? districts[0] ?? null;
  const askedOffice = positive(one(params.dsOfficeId) ?? "");
  const office = chosen?.offices.find((o) => o.id === askedOffice) ?? null;
  const cases = chosen ? await casesForLetter(db, viewer, chosen.id, locale, office?.id ?? null) : [];

  const now = new Date();
  const groups: LetterFormGroup[] = [];
  for (const c of cases) {
    let group = groups.at(-1);
    if (group?.office !== c.officeName) groups.push((group = { office: c.officeName, cases: [] }));
    const entered =
      daysBetween(c.createdAt, now) > 0
        ? t("letters.enteredOn", { date: formatDate(c.createdAt) })
        : t("letters.enteredToday");
    group.cases.push({
      id: c.id,
      version: c.version,
      name: caseName(tc, c.name, c.childName),
      detail: t("letters.caseDetail", {
        number: c.applicationNumber,
        category: tc(`category.${c.category}`),
        kind: tc(`kindShort.${c.kind}`),
        entered,
      }),
      residence: c.residenceName && t("letters.livesIn", { office: c.residenceName }),
      duplicates: c.duplicates.map((match) => ({
        id: match.id,
        text: t("duplicates.item", {
          number: match.applicationNumber,
          name: caseName(tc, match.name, match.childName),
          office: match.officeName,
          status: tc(`status.${match.status}`),
        }),
      })),
      enteredOn: colomboDay(c.createdAt),
      amendmentWaiting: c.amendmentWaiting,
    });
  }

  return (
    <div className="flex flex-col gap-4.5">
      <h1 className="text-[28px] leading-snug font-bold">{t("title")}</h1>

      <LetterNotice letter={recorded} />

      {chosen && <AllocateFilters districts={districts} districtId={chosen.id} dsOfficeId={office?.id ?? null} />}

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
                        href={allocateHref(d.id, null)}
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
                          {t("letters.districtOffices", { offices: d.offices.map((o) => o.name).join(", ") })}
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
                    <Link
                      href={allocateHref(chosen?.id ?? null, office?.id ?? null, letter.id)}
                      scroll={false}
                      className="self-start text-[15px] font-bold text-primary underline-offset-2 hover:underline"
                    >
                      {t("letters.recordedName", { district: letter.districtName, number: letter.letterNumber })}
                    </Link>
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
              {office && (
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 self-start rounded-lg bg-accent px-3.5 py-2 text-[15px] font-semibold text-primary">
                  {t("letters.onlyOffice", { office: office.name })}
                  <Link
                    href={allocateHref(chosen.id, null)}
                    className="font-bold underline underline-offset-2 hover:no-underline"
                  >
                    {t("letters.showAll")}
                  </Link>
                </p>
              )}
            </div>
            <LetterForm
              // A case that changed or left the list starts the form again.
              key={`${chosen.id}:${office?.id ?? ""}:${cases.map((c) => `${c.id}.${c.version}`).join(",")}`}
              districtId={chosen.id}
              dsOfficeId={office?.id ?? null}
              districtName={chosen.name}
              groups={groups}
              today={colomboDay(now)}
              action={recordLetterAction}
              upload={uploadLetterScanAction}
            />
          </section>
        )}
      </div>

      {opened && (
        <SentPopup
          title={t("sent.letterTitle", { number: opened.letterNumber })}
          subtitle={t("sent.letterSubtitle", { district: opened.districtName, date: formatDate(opened.letterDate) })}
          closeHref={allocateHref(chosen?.id ?? null, office?.id ?? null)}
        >
          <SentCases cases={opened.cases} href={(caseId) => `/ministry/cases/${caseId}`} />
        </SentPopup>
      )}
    </div>
  );
}
