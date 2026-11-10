import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { caseName } from "@/components/cases/page-header";
import { LetterForm, type LetterFormGroup } from "@/components/review/letter-form";
import { LetterNotice } from "@/components/review/review-notice";
import { colomboDay, daysBetween, formatDate } from "@/lib/dates";
import { formatRupees, RELEASE_AMOUNT } from "@/lib/money";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { positive } from "@/components/cases/list-filters";
import { casesForLetter, districtsWaiting, getLetter, recentLetters } from "@/server/releases/queries";
import { recordLetterAction, uploadLetterScanAction } from "./actions";

export type LetterSearchParams = Promise<{
  notice?: string | string[];
  districtId?: string | string[];
  letter?: string | string[];
}>;

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

/**
 * REL-1, REL-2, as in the prototype's release tab: the Ministry releases money by one allocation letter to
 * a District Secretary for several cases of the district awaiting their allocation. On the left, the
 * districts whose cases wait for a letter, and the letters recorded last; on the right, the chosen
 * district's letter (`?districtId=`, or the first district waiting). Nobody checks a case first (change
 * 0006); its task 6 turns this into the Ministry's allocation screen.
 */
export async function LetterScreen({ searchParams }: { searchParams: LetterSearchParams }) {
  const viewer = await requireRole("MINISTRY_OFFICER");
  const params = await searchParams;
  const askedId = positive(one(params.districtId) ?? "");
  const letterId = params.notice === "letterRecorded" ? one(params.letter) : null;

  const locale = await getLocale();
  const [t, tc, districts, letters, recorded] = await Promise.all([
    getTranslations("review"),
    getTranslations("cases"),
    districtsWaiting(db, viewer, locale),
    recentLetters(db, viewer, locale),
    letterId && letterId.length <= 64 ? getLetter(db, viewer, letterId, locale) : null,
  ]);
  const chosen = districts.find((d) => d.id === askedId) ?? districts[0] ?? null;
  const cases = chosen ? await casesForLetter(db, viewer, chosen.id, locale) : [];

  const now = new Date();
  const groups: LetterFormGroup[] = [];
  for (const c of cases) {
    let group = groups.at(-1);
    if (group?.office !== c.officeName) groups.push((group = { office: c.officeName, cases: [] }));
    const number = c.applicationNumber;
    group.cases.push({
      id: c.id,
      version: c.version,
      name: caseName(tc, c.name, c.childName),
      detail:
        daysBetween(c.createdAt, now) > 0
          ? t("letters.enteredOn", { number, date: formatDate(c.createdAt) })
          : t("letters.enteredToday", { number }),
      enteredOn: colomboDay(c.createdAt),
    });
  }

  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[28px] leading-snug font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </div>

      <LetterNotice letter={recorded} />

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
                        href={`/ministry/release?districtId=${d.id}`}
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
    </div>
  );
}
