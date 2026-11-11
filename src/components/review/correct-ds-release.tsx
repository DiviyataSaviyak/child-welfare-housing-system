"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import type { DsReleaseState } from "@/app/oversight/release/actions";
import { FormError } from "@/components/forms/form-field";
import { Modal } from "@/components/modal";
import {
  DS_RELEASE_FIELDS,
  type DsReleaseDateLimits,
  type DsReleaseErrors,
  parseDsReleaseForm,
} from "@/lib/validation/ds-release";
import { DsReleaseFields, type DsReleaseFormValues } from "./ds-release-fields";

/**
 * REL-8: the District officer corrects the District release behind a case, in a pop-up: its reference
 * number, date or note. The change is for every case on the release, which the pop-up says. The browser
 * runs the server's checks first, and what was typed stays after a refusal (ERR-1).
 */
export function CorrectDsRelease({
  caseId,
  version,
  limits,
  current,
  cases,
  action,
}: {
  caseId: string;
  version: number;
  /** From the latest Ministry letter of the release's cases to today. */
  limits: DsReleaseDateLimits;
  current: DsReleaseFormValues;
  /** How many cases the release released. */
  cases: number;
  action: (state: DsReleaseState, form: FormData) => Promise<DsReleaseState>;
}) {
  const t = useTranslations("review");
  const [open, setOpen] = useState(false);
  const [state, dispatch, pending] = useActionState(action, { error: null, errors: {} });
  const [, startTransition] = useTransition();
  const [values, setValues] = useState(current);
  // The browser's own checks; null once the form has gone to the server, whose answer then shows.
  const [checkErrors, setCheckErrors] = useState<DsReleaseErrors | null>(null);

  function submit() {
    const checked = parseDsReleaseForm((field) => values[field], limits);
    if (!checked.ok) {
      setCheckErrors(checked.errors);
      return;
    }
    setCheckErrors(null);
    const form = new FormData();
    form.set("caseId", caseId);
    form.set("version", String(version));
    for (const field of DS_RELEASE_FIELDS) form.set(field, values[field]);
    startTransition(() => dispatch(form));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-11 self-start rounded-lg border border-primary bg-card px-4.5 font-semibold text-primary"
      >
        {t("dsCorrect.button")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy="correct-ds-release-title" size="wide">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3.5"
        >
          <h2 id="correct-ds-release-title" className="text-[22px] font-bold">
            {t("dsCorrect.title")}
          </h2>
          <p className="font-semibold">{t("dsCorrect.cases", { count: cases })}</p>
          <DsReleaseFields
            idPrefix="correct"
            values={values}
            onChange={(field, value) => setValues((now) => ({ ...now, [field]: value }))}
            errors={checkErrors ?? state.errors}
            limits={limits}
          />
          <p className="text-[15px] text-[#3F4843]">{t("correct.text")}</p>
          {checkErrors === null && state.error && (
            <FormError id="correct-ds-release-error" message={t(`errors.${state.error}`)} />
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
