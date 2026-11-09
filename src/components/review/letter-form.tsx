"use client";

import { FileText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useRef, useState, useTransition } from "react";
import type { LetterState } from "@/app/ministry/check/actions";
import { FormError } from "@/components/forms/form-field";
import { DOCUMENT_ACCEPT, documentProblem, SNIFF_BYTES } from "@/lib/file-types";
import { formatRupees, RELEASE_AMOUNT } from "@/lib/money";
import {
  defaultValidUntil,
  latestDay,
  parseReleaseForm,
  RELEASE_FIELDS,
  type ReleaseErrors,
} from "@/lib/validation/release";
import type { UploadedFile, UploadError } from "@/server/files/uploads";
import { LetterFields, type LetterValues } from "./letter-fields";

/** A verified case on the district's letter, as the server gives it. */
export type LetterFormCase = {
  id: string;
  version: number;
  /** The name, with the child's if any. */
  name: string;
  /** The case number and when it was verified. */
  detail: string;
  /** "YYYY-MM-DD", in Colombo. */
  verifiedOn: string | null;
};

export type LetterFormGroup = { office: string; cases: LetterFormCase[] };

type Scan =
  | { state: "uploading"; name: string }
  | { state: "done"; name: string; id: string }
  | { state: "refused"; name: string; problem: UploadError | "fileFailed" };

/**
 * REL-2, as in the prototype: one allocation letter to a District Secretary. The district's verified
 * cases are listed by DS office, all ticked to start with; the officer unticks any not named on the
 * letter. The total is Rs. 2,000,000 for each ticked case and is never typed in. The scan is optional
 * and uploads as soon as it is chosen. The browser runs the server's checks first, and what was typed
 * stays after a refusal (ERR-1).
 */
export function LetterForm({
  districtId,
  groups,
  today,
  action,
  upload,
}: {
  districtId: number;
  groups: LetterFormGroup[];
  /** "YYYY-MM-DD", in Colombo. */
  today: string;
  action: (state: LetterState, form: FormData) => Promise<LetterState>;
  upload: (form: FormData) => Promise<{ ok: true; value: UploadedFile } | { ok: false; error: UploadError }>;
}) {
  const t = useTranslations("review");
  const tf = useTranslations("cases.form");
  const locale = useLocale();
  const [state, dispatch, pending] = useActionState(action, { error: null, errors: {} });
  const [, startTransition] = useTransition();
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [values, setValues] = useState<LetterValues>({
    letterNumber: "",
    letterDate: today,
    validUntil: defaultValidUntil(today),
    note: "",
  });
  const [scan, setScan] = useState<Scan | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // The browser's own checks; null once the form has gone to the server, whose answer then shows.
  const [checkErrors, setCheckErrors] = useState<ReleaseErrors | null>(null);
  const [noCases, setNoCases] = useState(false);
  const errors = checkErrors ?? state.errors;

  const cases = groups.flatMap((group) => group.cases);
  const ticked = cases.filter((c) => !left.has(c.id));
  const total = formatRupees(ticked.length * RELEASE_AMOUNT, locale);
  const limits = { earliest: latestDay(ticked.map((c) => c.verifiedOn)), today };

  function toggle(id: string, on: boolean) {
    setNoCases(false);
    setLeft((current) => {
      const next = new Set(current);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function chooseScan(file: File) {
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const problem = documentProblem(file.size, head);
    if (problem) {
      setScan({ state: "refused", name: file.name, problem });
      return;
    }
    setScan({ state: "uploading", name: file.name });
    const form = new FormData();
    form.set("file", file);
    try {
      const result = await upload(form);
      setScan(
        result.ok
          ? { state: "done", name: file.name, id: result.value.id }
          : { state: "refused", name: file.name, problem: result.error },
      );
    } catch {
      setScan({ state: "refused", name: file.name, problem: "fileFailed" });
    }
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
        {groups.map((group) => (
          <div key={group.office} className="overflow-hidden rounded-lg border">
            <div className="bg-muted px-3.5 py-2 text-[15px] font-bold text-[#3F4843]">
              {t("letters.office", { office: group.office, count: group.cases.length })}
            </div>
            {group.cases.map((c) => {
              const on = !left.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-t px-3.5 py-2.5 ${
                    on ? "bg-card" : "bg-muted"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(event) => toggle(c.id, event.target.checked)}
                    className="size-5.5 accent-primary"
                  />
                  <span className={`flex min-w-0 flex-col ${on ? "" : "text-muted-foreground"}`}>
                    <span className="font-bold">{c.name}</span>
                    <span className="text-sm text-muted-foreground">{c.detail}</span>
                  </span>
                  <span className={`font-semibold ${on ? "" : "text-muted-foreground"}`}>
                    {on ? formatRupees(RELEASE_AMOUNT, locale) : t("letters.notOnLetter")}
                  </span>
                </label>
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
        <div className="flex flex-col gap-1.5">
          <span className="text-base font-semibold">{t("letters.scan")}</span>
          {scan && scan.state !== "refused" ? (
            <div className="flex items-center gap-3 rounded-lg border px-3.5 py-2.5">
              <FileText aria-hidden="true" className="size-5.5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col">
                {scan.state === "done" ? (
                  <a
                    href={`/files/${scan.id}`}
                    target="_blank"
                    rel="noopener"
                    className="truncate font-semibold text-primary underline"
                  >
                    {scan.name}
                  </a>
                ) : (
                  <span className="truncate font-semibold">{scan.name}</span>
                )}
                <span className="text-sm text-muted-foreground">
                  {scan.state === "uploading" ? t("letters.scanUploading") : t("letters.scanNotSaved")}
                </span>
              </span>
              {scan.state === "done" && (
                <button
                  type="button"
                  onClick={() => setScan(null)}
                  aria-label={t("letters.scanRemoveLabel", { name: scan.name })}
                  className="h-9.5 shrink-0 rounded-lg border border-input bg-card px-3.5 text-[15px] font-semibold"
                >
                  {t("letters.scanRemove")}
                </button>
              )}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="h-11 self-start rounded-lg border border-dashed border-[#8C877C] bg-card px-4 font-semibold"
              >
                {t("letters.scanChoose")}
              </button>
              {scan?.state === "refused" && (
                <p className="text-[15px] font-medium text-destructive">
                  {scan.name}: {tf(`errors.${scan.problem}`)}
                </p>
              )}
            </>
          )}
          <input
            ref={input}
            type="file"
            hidden
            accept={DOCUMENT_ACCEPT}
            data-testid="letter-scan-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Clearing the picker lets the same file be chosen again after it is removed.
              event.target.value = "";
              if (file) void chooseScan(file);
            }}
          />
        </div>
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
