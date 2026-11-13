"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import { FormError, FormField, FormTextArea } from "@/components/forms/form-field";
import { Modal } from "@/components/modal";
import { formatDate } from "@/lib/dates";
import { formatRupees } from "@/lib/money";
import {
  type AmountLimit,
  type DayLimits,
  PAID_FIELDS,
  parsePaidForm,
  parseStartForm,
  type ProgressErrorKey,
  START_FIELDS,
} from "@/lib/validation/progress";
import type { ProgressAction } from "./types";

type Field = "amount" | "expectedOn" | "releasedOn" | "purpose" | "note";

/**
 * The DS office's button on the next installment, as in the prototype: "start the payment" with the
 * day it expects to pay (INS-3), then "mark paid" with the day paid (INS-4). For a land kind, starting it
 * also asks its amount, offering the balance (fixed for installment 4), and "correct" changes a started one
 * while it is being paid (INS-7, INS-8). Each opens a pop-up whose form the browser checks as the server
 * does; what was typed stays after a refusal (ERR-1).
 */
export function InstallmentAction({
  step,
  caseId,
  version,
  number,
  installmentName,
  limits,
  amount,
  amountLimit = null,
  initial,
  action,
}: {
  step: "start" | "pay" | "correct";
  caseId: string;
  version: number;
  number: number;
  installmentName: string;
  /** From startLimits() or paidLimits(). */
  limits: DayLimits;
  /** The installment's amount: shown when it isn't typed. */
  amount: number;
  /** A land kind's amount, typed when starting or correcting (INS-7, INS-8); null when it is fixed by the kind. */
  amountLimit?: AmountLimit | null;
  initial: { amount: string; day: string; purpose: string; note: string };
  action: ProgressAction;
}) {
  const t = useTranslations("progress");
  const locale = useLocale();
  const [state, dispatch, pending] = useActionState(action, { error: null, errors: {} });
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const paying = step === "pay";
  const dayField = paying ? "releasedOn" : "expectedOn";
  const [values, setValues] = useState<Record<Field, string>>({
    amount: initial.amount,
    expectedOn: paying ? "" : initial.day,
    releasedOn: paying ? initial.day : "",
    purpose: initial.purpose,
    note: initial.note,
  });
  const typed = !paying && amountLimit !== null;
  // The browser's own checks; null once the form has gone to the server, whose answer then shows.
  const [checkErrors, setCheckErrors] = useState<Partial<Record<Field, ProgressErrorKey>> | null>(null);
  const errors: Partial<Record<Field, ProgressErrorKey>> = checkErrors ?? state.errors;
  // "Mark paid" and "correct" can share a row, so the correction's ids differ.
  const prefix = step === "correct" ? `installment-${number}-correct` : `installment-${number}`;
  const id = (field: Field) => `${prefix}-${field}`;
  // The release day comes first in the limits; the date picker starts at the latest earliest day.
  const releaseDay = limits.earliest[0]?.day ?? null;
  const minDay = limits.earliest
    .flatMap((e) => (e.day ? [e.day] : []))
    .sort()
    .at(-1);

  function submit() {
    const read = (field: Field) => values[field];
    const checked = paying ? parsePaidForm(read, limits) : parseStartForm(read, limits, typed ? amountLimit : null);
    if (!checked.ok) {
      setCheckErrors(checked.errors);
      return;
    }
    setCheckErrors(null);
    const form = new FormData();
    form.set("caseId", caseId);
    form.set("version", String(version));
    form.set("number", String(number));
    for (const field of paying ? PAID_FIELDS : START_FIELDS) form.set(field, values[field]);
    startTransition(() => dispatch(form));
  }

  const set = (field: Field) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));
  const errorText = (field: Field) => {
    const key = errors[field];
    return key ? t(`errors.${key}`) : undefined;
  };
  const title = t(`installments.${step}Title`, { installment: installmentName });
  const buttonLook = {
    start: "border border-primary bg-card text-primary",
    pay: "bg-primary text-primary-foreground",
    correct: "border border-input bg-card text-foreground",
  }[step];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`h-11.5 rounded-lg px-4.5 text-base font-semibold ${buttonLook}`}
      >
        {t(`installments.${step}`)}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy={`${prefix}-title`}>
        <h2 id={`${prefix}-title`} className="text-[22px] font-bold">
          {title}
        </h2>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4"
        >
          {typed ? (
            <FormField
              id={id("amount")}
              inputMode="numeric"
              label={t("installments.amountLand")}
              help={t(amountLimit.fixed ? "installments.amountFixedHelp" : "installments.amountHelp", {
                balance: formatRupees(amountLimit.max, locale),
              })}
              readOnly={amountLimit.fixed}
              value={values.amount}
              onChange={set("amount")}
              error={errorText("amount")}
            />
          ) : (
            <div className="flex items-center justify-between gap-4 rounded-lg bg-background px-4.5 py-3">
              <span className="font-semibold">{t("installments.amount")}</span>
              <span className="text-[22px] font-bold">{formatRupees(amount, locale)}</span>
            </div>
          )}
          <FormField
            id={id(dayField)}
            type="date"
            label={t(paying ? "installments.paidOn" : "installments.expectedOn")}
            help={
              !paying && releaseDay
                ? t("installments.expectedOnHelp", { date: formatDate(releaseDay) })
                : t("installments.paidOnHelp")
            }
            min={minDay}
            max={limits.latest ?? undefined}
            value={values[dayField]}
            onChange={set(dayField)}
            error={errorText(dayField)}
          />
          {!paying && (
            <FormField
              id={id("purpose")}
              label={t("installments.purpose")}
              value={values.purpose}
              onChange={set("purpose")}
              maxLength={200}
              error={errorText("purpose")}
            />
          )}
          <FormTextArea
            id={id("note")}
            label={t("installments.note")}
            value={values.note}
            onChange={set("note")}
            error={errorText("note")}
          />
          {checkErrors === null && state.error && (
            <FormError id={`${prefix}-error`} message={t(`errors.${state.error}`)} />
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-12 rounded-lg border border-input px-6 text-[17px] font-semibold"
            >
              {t("installments.cancel")}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="h-12 rounded-lg bg-primary px-6.5 text-[17px] font-bold text-primary-foreground disabled:opacity-60"
            >
              {pending ? t("installments.working") : t("installments.save")}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
