"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import { FormError, FormTextArea } from "@/components/forms/form-field";
import { Modal } from "@/components/modal";
import { parseReason, type ReasonErrorKey } from "@/lib/validation/decision";
import type { ProgressAction, ProgressError } from "./types";

const REASON_ERRORS: readonly string[] = ["reasonRequired", "reasonTooShort", "reasonTooLong"];
const isReasonError = (error: ProgressError | null): error is ReasonErrorKey =>
  error !== null && REASON_ERRORS.includes(error);

export type ReasonTexts = {
  button: string;
  title: string;
  text: string;
  reason: string;
  reasonHelp: string;
  confirm: string;
  cancel: string;
  working: string;
};

const BUTTON = {
  danger: "h-12 border border-destructive bg-card px-5 text-base font-semibold text-destructive",
  small: "h-10 border border-input bg-card px-3.5 text-[15px] font-semibold",
} as const;

/**
 * A button that opens a pop-up asking for a reason, then sends it: deleting a case awaiting its allocation
 * (CASE-8) or undoing a payment (INS-6). The reason is checked in the browser as on the server (5 to
 * 1,000 characters), and what was typed stays after a refusal (ERR-1).
 */
export function ReasonAction({
  id,
  texts,
  look,
  hidden,
  action,
}: {
  /** Makes the pop-up's ids unique on the page. */
  id: string;
  texts: ReasonTexts;
  look: keyof typeof BUTTON;
  /** What the action needs besides the reason, such as the case and its version. */
  hidden: Record<string, string>;
  action: ProgressAction;
}) {
  const t = useTranslations("progress");
  const [state, dispatch, pending] = useActionState(action, { error: null, errors: {} });
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  // The browser's own check; null once the reason has gone to the server.
  const [checkError, setCheckError] = useState<ReasonErrorKey | null>(null);
  const reasonError = checkError ?? (isReasonError(state.error) ? state.error : null);
  const otherError = checkError === null && state.error !== null && !isReasonError(state.error) ? state.error : null;
  const danger = look === "danger";

  function send() {
    const checked = parseReason(reason);
    if (!checked.ok) {
      setCheckError(checked.error);
      return;
    }
    setCheckError(null);
    const form = new FormData();
    for (const [name, value] of Object.entries(hidden)) form.set(name, value);
    form.set("reason", reason);
    startTransition(() => dispatch(form));
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`shrink-0 rounded-lg ${BUTTON[look]}`}>
        {texts.button}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy={`${id}-title`}>
        <h2 id={`${id}-title`} className="text-[22px] font-bold">
          {texts.title}
        </h2>
        <p>{texts.text}</p>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          className="flex flex-col gap-4"
        >
          <FormTextArea
            id={`${id}-reason`}
            label={texts.reason}
            help={texts.reasonHelp}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={reasonError ? t(`errors.${reasonError}`) : undefined}
            autoFocus
          />
          {otherError && <FormError id={`${id}-error`} message={t(`errors.${otherError}`)} />}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-12 rounded-lg border border-input px-6 text-[17px] font-semibold"
            >
              {texts.cancel}
            </button>
            <button
              type="submit"
              disabled={pending}
              className={`h-12 rounded-lg px-6 text-[17px] font-bold text-white disabled:opacity-60 ${danger ? "bg-destructive" : "bg-primary"}`}
            >
              {pending ? texts.working : texts.confirm}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
