"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import type { DecisionState } from "@/app/ho/check/actions";
import { FormError, FormTextArea } from "@/components/forms/form-field";
import { Modal } from "@/components/modal";
import { parseReason, type ReasonErrorKey } from "@/lib/validation/decision";
import type { Decision } from "@/server/cases/decide";
import type { QueuePlace } from "@/server/cases/queues";

const REASON_ERRORS: readonly string[] = ["reasonRequired", "reasonTooShort", "reasonTooLong"];
const isReasonError = (error: string | null): error is ReasonErrorKey =>
  error !== null && REASON_ERRORS.includes(error);

/**
 * CHK-3, as in the prototype: verify (after one confirmation), send back or reject. The last two open
 * a box for the reason the DS office will read; rejecting can also ask the DS office for another name
 * in the case's place (CASE-11). What was typed stays after a refusal (ERR-1).
 */
export function DecisionPanel({
  caseId,
  version,
  from,
  place,
  caseLabel,
  action,
}: {
  caseId: string;
  version: number;
  /** Where the officer is deciding, so the next page is the right one. */
  from: "queue" | "case";
  /** The queue's district or DS office, which the next page keeps (CHK-4). */
  place?: QueuePlace;
  /** The case's name and number, for the confirmation. */
  caseLabel: { name: string; number: string };
  action: (state: DecisionState, form: FormData) => Promise<DecisionState>;
}) {
  const t = useTranslations("review");
  const [state, dispatch, pending] = useActionState(action, { error: null });
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<"sendBack" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [askName, setAskName] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // The browser's own check of the reason; null once the form has gone to the server.
  const [checkError, setCheckError] = useState<ReasonErrorKey | null>(null);

  const reasonError = checkError ?? (isReasonError(state.error) ? state.error : null);
  const otherError = checkError === null && state.error !== null && !isReasonError(state.error) ? state.error : null;

  function send(decision: Decision) {
    const form = new FormData();
    form.set("caseId", caseId);
    form.set("version", String(version));
    form.set("from", from);
    if (place?.districtId) form.set("districtId", String(place.districtId));
    if (place?.dsOfficeId) form.set("dsOfficeId", String(place.dsOfficeId));
    form.set("decision", decision);
    form.set("reason", decision === "verify" ? "" : reason);
    if (decision === "reject" && askName) form.set("anotherName", "1");
    startTransition(() => dispatch(form));
  }

  function confirmReason() {
    if (!mode) return;
    const checked = parseReason(reason);
    if (!checked.ok) {
      setCheckError(checked.error);
      return;
    }
    setCheckError(null);
    send(mode);
  }

  const open = (next: "sendBack" | "reject") => {
    setMode(next);
    setAskName(false);
    setCheckError(null);
  };

  return (
    <section aria-labelledby="decision-title" className="flex flex-col gap-3 border-t pt-4">
      <h3 id="decision-title" className="text-lg font-bold">
        {t("decision.title")}
      </h3>
      {mode === null ? (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
            className="h-12.5 rounded-lg bg-primary px-6.5 text-[17px] font-bold text-primary-foreground disabled:opacity-60"
          >
            {t("decision.verify")}
          </button>
          <button
            type="button"
            onClick={() => open("sendBack")}
            disabled={pending}
            className="h-12.5 rounded-lg border border-input bg-card px-5.5 text-[17px] font-semibold"
          >
            {t("decision.sendBack")}
          </button>
          <button
            type="button"
            onClick={() => open("reject")}
            disabled={pending}
            className="h-12.5 rounded-lg border border-destructive bg-card px-5.5 text-[17px] font-semibold text-destructive"
          >
            {t("decision.reject")}
          </button>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            confirmReason();
          }}
          className={`flex flex-col gap-2.5 rounded-lg border-2 p-4 ${mode === "reject" ? "border-destructive" : "border-primary"}`}
        >
          <FormTextArea
            id="decision-reason"
            label={mode === "reject" ? t("decision.rejectReason") : t("decision.sendBackReason")}
            help={t("decision.reasonHelp")}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={reasonError ? t(`errors.${reasonError}`) : undefined}
            autoFocus
          />
          {mode === "reject" && (
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border-[1.5px] px-3.5 py-3 ${
                askName ? "border-primary bg-accent" : "border-border bg-card"
              }`}
            >
              <input
                type="checkbox"
                checked={askName}
                onChange={(event) => setAskName(event.target.checked)}
                className="mt-0.5 size-[22px] shrink-0 accent-primary"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-bold">{t("decision.askName")}</span>
                <span className="text-sm text-[#3F4843]">{t("decision.askNameHelp")}</span>
              </span>
            </label>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setMode(null);
                setCheckError(null);
              }}
              className="h-12 rounded-lg border border-input bg-card px-5 font-semibold"
            >
              {t("decision.cancel")}
            </button>
            <button
              type="submit"
              disabled={pending}
              className={`h-12 rounded-lg px-5.5 font-bold text-white disabled:opacity-60 ${mode === "reject" ? "bg-destructive" : "bg-primary"}`}
            >
              {pending
                ? t("decision.working")
                : mode === "reject"
                  ? t(askName ? "decision.confirmRejectAsk" : "decision.confirmReject")
                  : t("decision.confirmSendBack")}
            </button>
          </div>
        </form>
      )}
      {otherError && <FormError id="decision-error" message={t(`errors.${otherError}`)} />}

      <Modal open={confirming} onClose={() => setConfirming(false)} labelledBy="verify-title">
        <h2 id="verify-title" className="text-[22px] font-bold">
          {t("decision.verifyTitle")}
        </h2>
        <p>{t("decision.verifyText", caseLabel)}</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-12 rounded-lg border border-input px-6 text-[17px] font-semibold"
          >
            {t("decision.verifyBack")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setConfirming(false);
              send("verify");
            }}
            className="h-12 rounded-lg bg-primary px-6 text-[17px] font-bold text-primary-foreground"
          >
            {t("decision.verifyConfirm")}
          </button>
        </div>
      </Modal>
    </section>
  );
}
