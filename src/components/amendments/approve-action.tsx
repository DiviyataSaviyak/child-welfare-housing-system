"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import { FormError } from "@/components/forms/form-field";
import { Modal } from "@/components/modal";
import type { ProgressAction } from "@/components/progress/types";

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
 * AMD-4: the Ministry's "approve" button, which asks once to confirm. A refusal, such as a rule AMD-5 found
 * broken, stays in the pop-up so the officer can read it and reject the amendment instead.
 */
export function ApproveAction({
  texts,
  hidden,
  action,
}: {
  texts: ApproveTexts;
  /** The amendment and the versions the page showed (CASE-10). */
  hidden: Record<string, string>;
  action: ProgressAction;
}) {
  const t = useTranslations("progress");
  const [state, dispatch, pending] = useActionState(action, { error: null, errors: {} });
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function send() {
    const form = new FormData();
    for (const [name, value] of Object.entries(hidden)) form.set(name, value);
    startTransition(() => dispatch(form));
  }

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
        {texts.money && <p>{texts.money}</p>}
        {state.error && <FormError id="approve-error" message={t(`errors.${state.error}`)} />}
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
            className="h-12 rounded-lg bg-primary px-6 text-[17px] font-bold text-white disabled:opacity-60"
          >
            {pending ? texts.working : texts.confirm}
          </button>
        </div>
      </Modal>
    </>
  );
}
