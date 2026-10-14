"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { CredentialsBox } from "@/components/credentials-box";
import { FormError } from "@/components/forms/form-field";
import { Modal } from "@/components/modal";
import {
  type CloseRequestState,
  closeRequestAction,
  type DisableState,
  type ResetState,
  resetPasswordAction,
  setDisabledAction,
} from "./actions";

const rowButton = "h-11 rounded-lg border px-3.5 text-[15px] font-semibold";

/**
 * Edit, new password, and disable/enable for one row of the users list (ADM-4 to ADM-6). `askedOn` is
 * the day someone asked for a new password on the sign-in page, while that request waits (AUTH-7).
 */
export function AccountActions({
  id,
  name,
  mobile,
  active,
  isSelf,
  askedOn,
}: {
  id: string;
  name: string;
  mobile: string | null;
  active: boolean;
  isSelf: boolean;
  askedOn: string | null;
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
      {active && (
        <ResetPassword
          key={resetRound}
          id={id}
          name={name}
          mobile={mobile}
          askedOn={askedOn}
          onFinished={() => setResetRound((n) => n + 1)}
        />
      )}
      {/* A new key when the status flips closes the pop-up and clears its state; on error it stays open. */}
      {!isSelf && <ToggleAccount key={String(active)} id={id} name={name} active={active} />}
    </div>
  );
}

/**
 * The new-password pop-up. While a request from the sign-in page waits, it asks the admin to call the
 * officer first, and can close the request instead of giving a password (AUTH-7).
 */
function ResetPassword({
  id,
  name,
  mobile,
  askedOn,
  onFinished,
}: {
  id: string;
  name: string;
  mobile: string | null;
  askedOn: string | null;
  onFinished: () => void;
}) {
  const t = useTranslations("users");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPasswordAction.bind(null, id), {
    error: null,
    credentials: null,
  });
  const [closeState, closeRequest, closing] = useActionState<CloseRequestState, FormData>(
    async () => {
      const result = await closeRequestAction(id);
      if (!result.error) setOpen(false);
      return result;
    },
    { error: null },
  );
  const error = state.error ?? closeState.error;
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
        className={`${rowButton} ${askedOn ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}
      >
        {t("resetPassword")}
      </button>
      {/* Wide while a request waits, so its three buttons fit on one line. */}
      <Modal open={open} onClose={close} labelledBy={`reset-${id}`} size={askedOn ? "wide" : "normal"}>
        {state.credentials ? (
          <>
            <h2 id={`reset-${id}`} className="text-[22px] font-bold">
              {t("confirm.resetDone")}
            </h2>
            <p>{t("confirm.resetDoneText", { name })}</p>
            {mobile && <p className="font-semibold">{t("confirm.mobile", { mobile })}</p>}
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
            {askedOn && (
              <div className="flex flex-col gap-1 rounded-lg bg-notice px-4 py-3 text-notice-foreground">
                <p className="font-semibold">{t("confirm.askedText", { name, date: askedOn })}</p>
                <p>{mobile ? t("confirm.callFirst", { mobile }) : t("confirm.callFirstNoMobile")}</p>
              </div>
            )}
            <p>{t("confirm.resetText", { name })}</p>
            {error && <FormError id={`reset-error-${id}`} message={t(`form.errors.${error}`)} />}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={close}
                className="h-12 rounded-lg border border-input px-6 text-[17px] font-semibold"
              >
                {t("confirm.cancel")}
              </button>
              {askedOn && (
                <button
                  type="submit"
                  formAction={closeRequest}
                  disabled={pending || closing}
                  className="h-12 rounded-lg border border-input px-6 text-[17px] font-semibold"
                >
                  {closing ? t("confirm.working") : t("confirm.closeRequest")}
                </button>
              )}
              <button
                type="submit"
                disabled={pending || closing}
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
