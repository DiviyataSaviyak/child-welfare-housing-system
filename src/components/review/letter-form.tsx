"use client";

import { TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import type { LetterState } from "@/app/ministry/allocate/actions";
import { FormError } from "@/components/forms/form-field";
import { formatRupees, RELEASE_AMOUNT } from "@/lib/money";
import {
  defaultValidUntil,
  latestDay,
  parseReleaseForm,
  RELEASE_FIELDS,
  type ReleaseErrors,
} from "@/lib/validation/release";
import { LetterFields, type LetterValues } from "./letter-fields";
import { type Scan, ScanPicker, type ScanUpload, TickAll } from "./scan-picker";

/** A case awaiting its allocation on the district's letter, as the server gives it. */
export type LetterFormCase = {
  id: string;
  version: number;
  /** The name, with the child's if any. */
  name: string;
  /** The Application Number, category, kind and when it was entered. */
  detail: string;
  /** Where the beneficiary lives, when it isn't the DS office where it is built (CASE-13). */
  residence: string | null;
  /** The other cases with the same NIC, each with its link's text (CASE-6). */
  duplicates: { id: string; text: string }[];
  /** "YYYY-MM-DD", in Colombo: the day it was entered. */
  enteredOn: string;
};

export type LetterFormGroup = { office: string; cases: LetterFormCase[] };

/**
 * REL-2, as in the prototype: one allocation letter to a District Secretary. The district's cases
 * awaiting their allocation are listed by DS office, none ticked to start with, because the Ministry
 * chooses whom it funds; each office and the whole district have "tick all". A case that shares its NIC
 * with another shows a flag that opens the matches (CASE-6). The total is Rs. 2,000,000 for each ticked
 * case and is never typed in. The scan is optional and uploads as soon as it is chosen. The browser runs
 * the server's checks first, and what was typed stays after a refusal (ERR-1).
 */
export function LetterForm({
  districtId,
  districtName,
  groups,
  today,
  action,
  upload,
}: {
  districtId: number;
  districtName: string;
  groups: LetterFormGroup[];
  /** "YYYY-MM-DD", in Colombo. */
  today: string;
  action: (state: LetterState, form: FormData) => Promise<LetterState>;
  upload: ScanUpload;
}) {
  const t = useTranslations("review");
  const locale = useLocale();
  const [state, dispatch, pending] = useActionState(action, { error: null, errors: {} });
  const [, startTransition] = useTransition();
  const [on, setOn] = useState<ReadonlySet<string>>(new Set());
  const [values, setValues] = useState<LetterValues>({
    letterNumber: "",
    letterDate: today,
    validUntil: defaultValidUntil(today),
    note: "",
  });
  const [scan, setScan] = useState<Scan | null>(null);
  // The browser's own checks; null once the form has gone to the server, whose answer then shows.
  const [checkErrors, setCheckErrors] = useState<ReleaseErrors | null>(null);
  const [noCases, setNoCases] = useState(false);
  const errors = checkErrors ?? state.errors;

  const cases = groups.flatMap((group) => group.cases);
  const ticked = cases.filter((c) => on.has(c.id));
  const total = formatRupees(ticked.length * RELEASE_AMOUNT, locale);
  const limits = { earliest: latestDay(ticked.map((c) => c.enteredOn)), today };

  function tick(ids: string[], value: boolean) {
    setNoCases(false);
    setOn((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (value) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function submit() {
    const checked = parseReleaseForm((field) => values[field], limits);
    setNoCases(ticked.length === 0);
    if (!checked.ok || ticked.length === 0) {
      setCheckErrors(checked.ok ? {} : checked.errors);
      return;
    }
    setCheckErrors(null);
    const form = new FormData();
    form.set("districtId", String(districtId));
    for (const c of ticked) form.append("case", `${c.id}:${c.version}`);
    for (const field of RELEASE_FIELDS) form.set(field, values[field]);
    if (scan?.state === "done") form.set("scanId", scan.id);
    startTransition(() => dispatch(form));
  }

  const formError = noCases ? "noCases" : checkErrors === null ? state.error : null;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4.5"
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">{t("letters.casesLabel")}</legend>
        <TickAll
          label={t("letters.tickDistrict", { district: districtName })}
          ids={cases.map((c) => c.id)}
          ticked={on}
          onChange={tick}
        />
        {groups.map((group) => (
          <div key={group.office} className="overflow-hidden rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-muted px-3.5 py-2">
              <span className="text-[15px] font-bold text-[#3F4843]">
                {t("letters.office", { office: group.office, count: group.cases.length })}
              </span>
              <TickAll
                label={t("letters.tickOffice", { office: group.office })}
                ids={group.cases.map((c) => c.id)}
                ticked={on}
                onChange={tick}
              />
            </div>
            {group.cases.map((c) => {
              const ticks = on.has(c.id);
              return (
                <div key={c.id} className={`border-t ${ticks ? "bg-card" : "bg-muted"}`}>
                  <label className="grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5">
                    <input
                      type="checkbox"
                      checked={ticks}
                      onChange={(event) => tick([c.id], event.target.checked)}
                      className="size-5.5 accent-primary"
                    />
                    <span className={`flex min-w-0 flex-col ${ticks ? "" : "text-muted-foreground"}`}>
                      <span className="font-bold">{c.name}</span>
                      <span className="text-sm text-muted-foreground">{c.detail}</span>
                      {c.residence && <span className="text-sm text-[#3F4843]">{c.residence}</span>}
                    </span>
                    <span className={`font-semibold ${ticks ? "" : "text-muted-foreground"}`}>
                      {ticks ? formatRupees(RELEASE_AMOUNT, locale) : t("letters.notOnLetter")}
                    </span>
                  </label>
                  {c.duplicates.length > 0 && (
                    <details className="mr-3.5 mb-2.5 ml-[54px] rounded-md border border-[#E8B45A] bg-[#FFF4E0] px-3 py-1.5 text-[#6B3A04]">
                      <summary className="cursor-pointer text-sm font-semibold">
                        <TriangleAlert aria-hidden="true" className="mr-1.5 inline size-4 align-[-3px]" />
                        {t("letters.duplicateFlag", { count: c.duplicates.length })}
                      </summary>
                      <ul className="mt-1 flex flex-col gap-0.5 pb-1 text-sm">
                        {c.duplicates.map((match) => (
                          <li key={match.id}>
                            <a
                              href={`/ministry/cases/${match.id}`}
                              target="_blank"
                              rel="noopener"
                              className="font-semibold underline underline-offset-2"
                            >
                              {match.text}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </fieldset>

      <div className="flex items-center justify-between gap-4 rounded-lg bg-background px-4.5 py-3.5">
        <span className="flex flex-col">
          <span className="text-[17px] font-semibold">{t("letters.total")}</span>
          <span className="text-sm text-muted-foreground">{t("letters.totalHelp", { count: ticked.length })}</span>
        </span>
        <span className="text-[26px] font-bold" data-testid="letter-total">
          {total}
        </span>
      </div>

      <LetterFields
        idPrefix="letter"
        values={values}
        onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
        errors={errors}
        limits={limits}
      >
        <ScanPicker scan={scan} onChange={setScan} upload={upload} />
      </LetterFields>

      {formError && <FormError id="letter-error" message={t(`errors.${formError}`)} />}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || scan?.state === "uploading"}
          className="h-13 shrink-0 rounded-lg bg-primary px-6.5 text-[17px] font-bold text-primary-foreground disabled:opacity-60"
        >
          {pending ? t("letters.working") : t("letters.save", { amount: total })}
        </button>
      </div>
    </form>
  );
}
