"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { CredentialsBox } from "@/components/credentials-box";
import { FormError } from "@/components/forms/form-field";
import { Modal } from "@/components/modal";
import { type DisableState, type ResetState, resetPasswordAction, setDisabledAction } from "./actions";

const rowButton = "h-11 rounded-lg border px-3.5 text-[15px] font-semibold";

/** Edit, new password, and disable/enable for one row of the users list (ADM-4 to ADM-6). */
export function AccountActions({
  id,
  name,
  active,
  isSelf,
}: {
  id: string;
  name: string;
  active: boolean;
  isSelf: boolean;
}) {
  const t = useTranslations("users");
  // A new key after each password reset starts the next one with a clean state, so a password is never shown twice.
  const [resetRound, setResetRound] = useState(0);

  return (
    <div className="flex items-center justify-end gap-2">
      <Link
        href={`/admin/users/${id}/edit`}
        aria-label={t("editLabel", { name })}
        className={`${rowButton} flex items-center border-input`}
      >
        {t("edit")}
      </Link>
      {active && <ResetPassword key={resetRound} id={id} name={name} onFinished={() => setResetRound((n) => n + 1)} />}
      {/* A new key when the status flips closes the pop-up and clears its state; on error it stays open. */}
      {!isSelf && <ToggleAccount key={String(active)} id={id} name={name} active={active} />}
    </div>
  );
}

function ResetPassword({ id, name, onFinished }: { id: string; name: string; onFinished: () => void }) {
  const t = useTranslations("users");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPasswordAction.bind(null, id), {
    error: null,
    credentials: null,
  });
  const close = () => {
    setOpen(false);
    if (state.credentials) onFinished();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("resetLabel", { name })}
        className={`${rowButton} border-input`}
      >
        {t("resetPassword")}
      </button>
      <Modal open={open} onClose={close} labelledBy={`reset-${id}`}>
        {state.credentials ? (
          <>
            <h2 id={`reset-${id}`} className="text-[22px] font-bold">
              {t("confirm.resetDone")}
            </h2>
            <p>{t("confirm.resetDoneText", { name })}</p>
            <CredentialsBox
              username={state.credentials.username}
              temporaryPassword={state.credentials.temporaryPassword}
            />
            <button
              type="button"
              onClick={close}
              className="h-12 self-end rounded-lg bg-primary px-8 text-[17px] font-semibold text-primary-foreground"
            >
              {t("confirm.close")}
            </button>
          </>
        ) : (
          <form action={action} className="flex flex-col gap-4">
            <h2 id={`reset-${id}`} className="text-[22px] font-bold">
              {t("confirm.resetTitle")}
            </h2>
            <p>{t("confirm.resetText", { name })}</p>
            {state.error && <FormError id={`reset-error-${id}`} message={t(`form.errors.${state.error}`)} />}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={close}
                className="h-12 rounded-lg border border-input px-6 text-[17px] font-semibold"
              >
                {t("confirm.cancel")}
              </button>
              <button
                type="submit"
                disabled={pending}
                className="h-12 rounded-lg bg-primary px-6 text-[17px] font-semibold text-primary-foreground"
              >
                {pending ? t("confirm.working") : t("resetPassword")}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

function ToggleAccount({ id, name, active }: { id: string; name: string; active: boolean }) {
  const t = useTranslations("users");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<DisableState, FormData>(setDisabledAction.bind(null, id, active), {
    error: null,
    done: false,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={active ? t("disableLabel", { name }) : t("enableLabel", { name })}
        className={`${rowButton} ${active ? "border-destructive text-destructive" : "border-primary text-primary"}`}
      >
        {active ? t("disable") : t("enable")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy={`toggle-${id}`}>
        <form action={action} className="flex flex-col gap-4">
          <h2 id={`toggle-${id}`} className="text-[22px] font-bold">
            {active ? t("confirm.disableTitle") : t("confirm.enableTitle")}
          </h2>
          <p>{active ? t("confirm.disableText", { name }) : t("confirm.enableText", { name })}</p>
          {state.error && <FormError id={`toggle-error-${id}`} message={t(`form.errors.${state.error}`)} />}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-12 rounded-lg border border-input px-6 text-[17px] font-semibold"
            >
              {t("confirm.cancel")}
            </button>
            <button
              type="submit"
              disabled={pending}
              className={`h-12 rounded-lg px-6 text-[17px] font-semibold text-white ${active ? "bg-destructive" : "bg-primary"}`}
            >
              {pending ? t("confirm.working") : active ? t("disable") : t("enable")}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
