"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import { FormError, FormField, FormTextArea } from "@/components/forms/form-field";
import { Modal } from "@/components/modal";
import type { ProgressAction } from "@/components/progress/types";
import {
  type DayLimits,
  parseReturnForm,
  type ProgressErrorKey,
  RETURN_FIELDS,
  type ReturnField,
} from "@/lib/validation/progress";

export type ApproveTexts = {
  button: string;
  title: string;
  text: string;
  /** The allocation that moves with it, when the case has one (AMD-5). */
  money: string | null;
  confirm: string;
  cancel: string;
  working: string;
};

/**
 * AMD-11: the return the approval records, when the new beneficiary is built outside the place the money has
 * reached: what goes back and where, the date's limits (from returnLimits) and the fields' labels.
 */
export type ReturnAsk = {
  title: string;
  text: string;
  limits: DayLimits;
  labels: Record<ReturnField, string>;
};

/**
 * AMD-4: the Ministry's "approve" button, which asks once to confirm. A refusal, such as a rule AMD-5 found
 * broken, stays in the pop-up so the officer can read it and reject the amendment instead. When the money goes
 * back (AMD-11), the pop-up also asks for the return's date, reference number and note, checked in the
 * browser as the server checks them.
 */
export function ApproveAction({
  texts,
  hidden,
  action,
  returnAsk = null,
}: {
  texts: ApproveTexts;
  /** The amendment and the versions the page showed (CASE-10). */
  hidden: Record<string, string>;
  action: ProgressAction;
  returnAsk?: ReturnAsk | null;
}) {
  const t = useTranslations("progress");
  const [state, dispatch, pending] = useActionState(action, { error: null, errors: {} });
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<ReturnField, string>>({ returnedOn: "", referenceNumber: "", note: "" });
  // The browser's own checks; null once the form has gone to the server, whose answer then shows.
  const [checkErrors, setCheckErrors] = useState<Partial<Record<ReturnField, ProgressErrorKey>> | null>(null);
  const errors: Partial<Record<string, ProgressErrorKey>> = checkErrors ?? state.errors;

  function send() {
    if (returnAsk) {
      const checked = parseReturnForm((field) => values[field], returnAsk.limits);
      if (!checked.ok) {
        setCheckErrors(checked.errors);
        return;
      }
    }
    setCheckErrors(null);
    const form = new FormData();
    for (const [name, value] of Object.entries(hidden)) form.set(name, value);
    if (returnAsk) {
      form.set("returnAsked", "1");
      for (const field of RETURN_FIELDS) form.set(field, values[field]);
    }
    startTransition(() => dispatch(form));
  }

  const set = (field: ReturnField) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));
  const errorText = (field: ReturnField) => {
    const key = errors[field];
    return key ? t(`errors.${key}`) : undefined;
  };
  const minDay = returnAsk?.limits.earliest
    .flatMap((e) => (e.day ? [e.day] : []))
    .sort()
    .at(-1);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-12 shrink-0 rounded-lg bg-primary px-6 text-[17px] font-bold text-primary-foreground"
      >
        {texts.button}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy="approve-title">
        <h2 id="approve-title" className="text-[22px] font-bold">
          {texts.title}
        </h2>
        <p>{texts.text}</p>
        {texts.money && !returnAsk && <p>{texts.money}</p>}
        {returnAsk && (
          <section aria-labelledby="return-title" className="flex flex-col gap-4 rounded-lg bg-background px-4.5 py-4">
            <h3 id="return-title" className="text-lg font-bold">
              {returnAsk.title}
            </h3>
            <p data-testid="approve-return-text">{returnAsk.text}</p>
            <FormField
              id="return-returnedOn"
              type="date"
              label={returnAsk.labels.returnedOn}
              min={minDay}
              max={returnAsk.limits.latest ?? undefined}
              value={values.returnedOn}
              onChange={set("returnedOn")}
              error={errorText("returnedOn")}
            />
            <FormField
              id="return-referenceNumber"
              label={returnAsk.labels.referenceNumber}
              maxLength={50}
              value={values.referenceNumber}
              onChange={set("referenceNumber")}
              error={errorText("referenceNumber")}
            />
            <FormTextArea
              id="return-note"
              label={returnAsk.labels.note}
              value={values.note}
              onChange={set("note")}
              error={errorText("note")}
            />
          </section>
        )}
        {checkErrors === null && state.error && <FormError id="approve-error" message={t(`errors.${state.error}`)} />}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-12 rounded-lg border border-input px-6 text-[17px] font-semibold"
          >
            {texts.cancel}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={pending}
            className="h-12 rounded-lg bg-primary px-6 text-[17px] font-bold text-primary-foreground disabled:opacity-60"
          >
            {pending ? texts.working : texts.confirm}
          </button>
        </div>
      </Modal>
    </>
  );
}
