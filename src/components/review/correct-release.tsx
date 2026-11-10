"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import type { ReleaseState } from "@/app/ministry/release/actions";
import { FormError } from "@/components/forms/form-field";
import { Modal } from "@/components/modal";
import { parseReleaseForm, RELEASE_FIELDS, type ReleaseDateLimits, type ReleaseErrors } from "@/lib/validation/release";
import { LetterFields, type LetterValues } from "./letter-fields";

/**
 * REL-4: Head Office corrects the allocation letter behind a case's release, in a pop-up: its number,
 * date, last valid day or note. The change is for every case on the letter, which the pop-up says.
 * The browser runs the server's checks first, and what was typed stays after a refusal (ERR-1).
 */
export function CorrectRelease({
  caseId,
  version,
  limits,
  current,
  cases,
  action,
}: {
  caseId: string;
  version: number;
  /** From the latest verification of the letter's cases to today. */
  limits: ReleaseDateLimits;
  current: LetterValues;
  /** How many cases the letter released. */
  cases: number;
  action: (state: ReleaseState, form: FormData) => Promise<ReleaseState>;
}) {
  const t = useTranslations("review");
  const [open, setOpen] = useState(false);
  const [state, dispatch, pending] = useActionState(action, { error: null, errors: {} });
  const [, startTransition] = useTransition();
  const [values, setValues] = useState(current);
  // The browser's own checks; null once the form has gone to the server, whose answer then shows.
  const [checkErrors, setCheckErrors] = useState<ReleaseErrors | null>(null);

  function submit() {
    const checked = parseReleaseForm((field) => values[field], limits);
    if (!checked.ok) {
      setCheckErrors(checked.errors);
      return;
    }
    setCheckErrors(null);
    const form = new FormData();
    form.set("caseId", caseId);
    form.set("version", String(version));
    for (const field of RELEASE_FIELDS) form.set(field, values[field]);
    startTransition(() => dispatch(form));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-11 self-start rounded-lg border border-primary bg-card px-4.5 font-semibold text-primary"
      >
        {t("correct.button")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy="correct-release-title" size="wide">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3.5"
        >
          <h2 id="correct-release-title" className="text-[22px] font-bold">
            {t("correct.title")}
          </h2>
          <p className="font-semibold">{t("correct.cases", { count: cases })}</p>
          <LetterFields
            idPrefix="correct"
            values={values}
            onChange={(field, value) => setValues((now) => ({ ...now, [field]: value }))}
            errors={checkErrors ?? state.errors}
            limits={limits}
          />
          <p className="text-[15px] text-[#3F4843]">{t("correct.text")}</p>
          {checkErrors === null && state.error && (
            <FormError id="correct-release-error" message={t(`errors.${state.error}`)} />
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-12 rounded-lg border border-input bg-card px-6 text-[17px] font-semibold"
            >
              {t("correct.cancel")}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="h-13 rounded-lg bg-primary px-6.5 text-[17px] font-bold text-primary-foreground disabled:opacity-60"
            >
              {pending ? t("correct.working") : t("correct.save")}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
