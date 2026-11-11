"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import type { DsReleaseState } from "@/app/oversight/release/actions";
import { FormError } from "@/components/forms/form-field";
import { formatRupees, RELEASE_AMOUNT } from "@/lib/money";
import { latestDay } from "@/lib/validation/release";
import { DS_RELEASE_FIELDS, type DsReleaseErrors, parseDsReleaseForm } from "@/lib/validation/ds-release";
import { DsReleaseFields, type DsReleaseFormValues } from "./ds-release-fields";
import { type Scan, ScanPicker, type ScanUpload, TickAll } from "./scan-picker";

/** A case the Ministry allocated, waiting for the District's release to its DS office, as the server gives it. */
export type DsReleaseFormCase = {
  id: string;
  version: number;
  /** The name, with the child's if any. */
  name: string;
  /** The Application Number, category and kind. */
  detail: string;
  /** The Ministry's letter that allocated it, with its date. */
  letter: string;
  /** Where the beneficiary lives, when it isn't the DS office where it is built (CASE-13). */
  residence: string | null;
  /** "YYYY-MM-DD": the date of its Ministry letter, the earliest the release can be dated (REL-6). */
  letterDate: string;
};

/**
 * REL-6: the District's release to one DS office. The office's cases the Ministry allocated are listed, the
 * oldest letter first, none ticked to start with, because the District chooses whom it funds; "tick all"
 * ticks them all. The total is Rs. 2,000,000 for each ticked case and is never typed in. The scan is optional
 * and uploads as soon as it is chosen. The browser runs the server's checks first, and what was typed stays
 * after a refusal (ERR-1).
 */
export function DsReleaseForm({
  dsOfficeId,
  officeName,
  cases,
  today,
  action,
  upload,
}: {
  dsOfficeId: number;
  officeName: string;
  cases: DsReleaseFormCase[];
  /** "YYYY-MM-DD", in Colombo. */
  today: string;
  action: (state: DsReleaseState, form: FormData) => Promise<DsReleaseState>;
  upload: ScanUpload;
}) {
  const t = useTranslations("review");
  const locale = useLocale();
  const [state, dispatch, pending] = useActionState(action, { error: null, errors: {} });
  const [, startTransition] = useTransition();
  const [on, setOn] = useState<ReadonlySet<string>>(new Set());
  const [values, setValues] = useState<DsReleaseFormValues>({ referenceNumber: "", releasedOn: today, note: "" });
  const [scan, setScan] = useState<Scan | null>(null);
  // The browser's own checks; null once the form has gone to the server, whose answer then shows.
  const [checkErrors, setCheckErrors] = useState<DsReleaseErrors | null>(null);
  const [noCases, setNoCases] = useState(false);
  const errors = checkErrors ?? state.errors;

  const ticked = cases.filter((c) => on.has(c.id));
  const total = formatRupees(ticked.length * RELEASE_AMOUNT, locale);
  const limits = { earliest: latestDay(ticked.map((c) => c.letterDate)), today };

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
    const checked = parseDsReleaseForm((field) => values[field], limits);
    setNoCases(ticked.length === 0);
    if (!checked.ok || ticked.length === 0) {
      setCheckErrors(checked.ok ? {} : checked.errors);
      return;
    }
    setCheckErrors(null);
    const form = new FormData();
    form.set("dsOfficeId", String(dsOfficeId));
    for (const c of ticked) form.append("case", `${c.id}:${c.version}`);
    for (const field of DS_RELEASE_FIELDS) form.set(field, values[field]);
    if (scan?.state === "done") form.set("scanId", scan.id);
    startTransition(() => dispatch(form));
  }

  const formError = noCases
    ? "noCasesRelease"
    : checkErrors === null && state.error
      ? state.error === "noCases"
        ? "noCasesRelease"
        : state.error
      : null;

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
        <legend className="sr-only">{t("district.casesLabel")}</legend>
        <div className="overflow-hidden rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-muted px-3.5 py-2">
            <span className="text-[15px] font-bold text-[#3F4843]">
              {t("letters.office", { office: officeName, count: cases.length })}
            </span>
            <TickAll
              label={t("letters.tickOffice", { office: officeName })}
              ids={cases.map((c) => c.id)}
              ticked={on}
              onChange={tick}
            />
          </div>
          {cases.map((c) => {
            const ticks = on.has(c.id);
            return (
              <label
                key={c.id}
                className={`grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-t px-3.5 py-2.5 ${
                  ticks ? "bg-card" : "bg-muted"
                }`}
              >
                <input
                  type="checkbox"
                  checked={ticks}
                  onChange={(event) => tick([c.id], event.target.checked)}
                  className="size-5.5 accent-primary"
                />
                <span className={`flex min-w-0 flex-col ${ticks ? "" : "text-muted-foreground"}`}>
                  <span className="font-bold">{c.name}</span>
                  <span className="text-sm text-muted-foreground">{c.detail}</span>
                  <span className="text-sm text-[#3F4843]">{c.letter}</span>
                  {c.residence && <span className="text-sm text-[#3F4843]">{c.residence}</span>}
                </span>
                <span className={`font-semibold ${ticks ? "" : "text-muted-foreground"}`}>
                  {ticks ? formatRupees(RELEASE_AMOUNT, locale) : t("district.notOnRelease")}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex items-center justify-between gap-4 rounded-lg bg-background px-4.5 py-3.5">
        <span className="flex flex-col">
          <span className="text-[17px] font-semibold">{t("letters.total")}</span>
          <span className="text-sm text-muted-foreground">{t("letters.totalHelp", { count: ticked.length })}</span>
        </span>
        <span className="text-[26px] font-bold" data-testid="release-total">
          {total}
        </span>
      </div>

      <DsReleaseFields
        idPrefix="release"
        values={values}
        onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
        errors={errors}
        limits={limits}
      >
        <ScanPicker scan={scan} onChange={setScan} upload={upload} />
      </DsReleaseFields>

      {formError && <FormError id="release-error" message={t(`errors.${formError}`)} />}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || scan?.state === "uploading"}
          className="h-13 shrink-0 rounded-lg bg-primary px-6.5 text-[17px] font-bold text-primary-foreground disabled:opacity-60"
        >
          {pending ? t("letters.working") : t("district.save", { amount: total })}
        </button>
      </div>
    </form>
  );
}
