"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { FormError, FormField, FormNotice } from "@/components/forms/form-field";
import { PasswordField } from "@/components/forms/password-field";
import { Button } from "@/components/ui/button";
import {
  askForCode,
  type AskForCodeState,
  checkCode,
  type CheckCodeState,
  setNewPassword,
  type SetNewPasswordState,
} from "../actions";

const backLink = "self-start text-base font-semibold text-primary underline underline-offset-4";
const mainButton = "h-12 gap-2 rounded-lg bg-sign-in text-[17px] font-semibold text-white hover:bg-sign-in/90";

/**
 * AUTH-7: the username, then the code sent by SMS, then the new password. Each step's state lives here
 * only, so leaving the page starts again from the username; "start again" does the same.
 */
export function ForgotPasswordForm() {
  const [round, setRound] = useState(0);
  return <Steps key={round} onRestart={() => setRound((n) => n + 1)} />;
}

function Steps({ onRestart }: { onRestart: () => void }) {
  const t = useTranslations("forgotPassword");
  const [state, action, pending] = useActionState<AskForCodeState, FormData>(askForCode, {
    error: null,
    username: "",
    ticket: null,
  });

  if (state.ticket) {
    // A new code gives a new ticket, which starts the code step afresh.
    return (
      <CodeStep
        key={state.ticket}
        ticket={state.ticket}
        username={state.username}
        askAgain={action}
        asking={pending}
        onRestart={onRestart}
      />
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormField
        id="username"
        name="username"
        label={t("username")}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={state.username}
        invalid={state.error !== null}
        errorId="forgot-password-error"
        required
      />
      {state.error && <FormError id="forgot-password-error" message={t(`errors.${state.error}`)} />}
      <Button type="submit" disabled={pending} aria-busy={pending} className={mainButton}>
        {pending && <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />}
        {pending ? t("submitting") : t("submit")}
      </Button>
      <p className="text-[15px] text-muted-foreground">{t("noUsername")}</p>
      <Link href="/login" className={backLink}>
        {t("backToSignIn")}
      </Link>
    </form>
  );
}

function CodeStep({
  ticket,
  username,
  askAgain,
  asking,
  onRestart,
}: {
  ticket: string;
  username: string;
  askAgain: (form: FormData) => void;
  asking: boolean;
  onRestart: () => void;
}) {
  const t = useTranslations("forgotPassword");
  const [state, action, pending] = useActionState<CheckCodeState, FormData>(checkCode, {
    error: null,
    checked: false,
  });

  if (state.checked) return <PasswordStep ticket={ticket} onRestart={onRestart} />;
  // The code no longer works; only a new one helps.
  const ended = state.error === "tooManyTries" || state.error === "expired";

  return (
    <div className="flex flex-col gap-5">
      <FormNotice message={t("code.sent")} />
      <form action={action} className="flex flex-col gap-5" noValidate>
        <input type="hidden" name="ticket" value={ticket} />
        <FormField
          id="code"
          name="code"
          label={t("code.label")}
          help={t("code.help")}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          invalid={state.error !== null}
          errorId="reset-code-error"
          required
        />
        {state.error && (
          <FormError id="reset-code-error" message={t(`codeErrors.${state.error}`, { count: state.count ?? 0 })} />
        )}
        {!ended && (
          <Button type="submit" disabled={pending} aria-busy={pending} className={mainButton}>
            {pending && <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />}
            {pending ? t("code.submitting") : t("code.submit")}
          </Button>
        )}
      </form>
      <form action={askAgain}>
        <input type="hidden" name="username" value={username} />
        <Button
          type="submit"
          variant="outline"
          disabled={asking}
          aria-busy={asking}
          className="h-12 w-full gap-2 rounded-lg text-[17px] font-semibold"
        >
          {asking && <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />}
          {asking ? t("submitting") : t("code.sendAgain")}
        </Button>
      </form>
      <p className="text-[15px] text-muted-foreground">{t("code.noSms")}</p>
      <button type="button" onClick={onRestart} className={backLink}>
        {t("startAgain")}
      </button>
    </div>
  );
}

function PasswordStep({ ticket, onRestart }: { ticket: string; onRestart: () => void }) {
  const t = useTranslations("forgotPassword");
  const [state, action, pending] = useActionState<SetNewPasswordState, FormData>(setNewPassword, { error: null });
  const expired = state.error === "expired";

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormNotice message={t("password.intro")} />
      <input type="hidden" name="ticket" value={ticket} />
      <PasswordField
        id="next"
        name="next"
        label={t("password.next")}
        help={t("password.nextHelp")}
        autoComplete="new-password"
        autoFocus
        invalid={state.error !== null && !expired}
        errorId="reset-password-error"
        required
      />
      <PasswordField
        id="confirm"
        name="confirm"
        label={t("password.confirm")}
        autoComplete="new-password"
        invalid={state.error !== null && !expired}
        errorId="reset-password-error"
        required
      />
      {state.error && <FormError id="reset-password-error" message={t(`passwordErrors.${state.error}`)} />}
      {expired ? (
        <Button type="button" onClick={onRestart} className={mainButton}>
          {t("startAgain")}
        </Button>
      ) : (
        <Button type="submit" disabled={pending} aria-busy={pending} className={mainButton}>
          {pending && <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />}
          {pending ? t("password.submitting") : t("password.submit")}
        </Button>
      )}
    </form>
  );
}
