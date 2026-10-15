"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { FormError, FormField, FormNotice } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import type { ProfileField } from "@/lib/validation/user";
import type { Profile } from "@/server/users/queries";
import type { ProfileFormState } from "./actions";

const EMPTY: ProfileFormState = { errors: {}, error: null, saved: false };

/** The officer's own name, designation, mobile number and email, checked as on the admin's account form. */
export function ProfileForm({
  profile,
  action,
  onClose,
}: {
  profile: Profile;
  action: (state: ProfileFormState, form: FormData) => Promise<ProfileFormState>;
  onClose: () => void;
}) {
  const t = useTranslations("users.form");
  const p = useTranslations("profile");
  const [state, formAction, pending] = useActionState(action, EMPTY);
  // Controlled fields keep what was typed when the server sends the form back with errors.
  const [values, setValues] = useState<Record<ProfileField, string>>(() => ({
    name: profile.name,
    designation: profile.designation ?? "",
    mobile: profile.mobile ?? "",
    contactEmail: profile.contactEmail ?? "",
  }));
  const set = (field: ProfileField) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  const error = (field: ProfileField) => {
    const key = state.errors[field];
    return key ? t(`errors.${key}`) : undefined;
  };
  const hasFieldErrors = Object.keys(state.errors).length > 0;

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <div className="grid grid-cols-2 gap-5">
        <FormField
          id="name"
          name="name"
          label={t("name")}
          value={values.name}
          onChange={set("name")}
          error={error("name")}
        />
        <FormField
          id="designation"
          name="designation"
          label={t("designation")}
          help={t("designationHint")}
          value={values.designation}
          onChange={set("designation")}
          error={error("designation")}
        />
        <FormField
          id="mobile"
          name="mobile"
          type="tel"
          label={t("mobile")}
          value={values.mobile}
          onChange={set("mobile")}
          error={error("mobile")}
        />
        <FormField
          id="contactEmail"
          name="contactEmail"
          type="email"
          label={t("contactEmail")}
          help={p("contactEmailHint")}
          value={values.contactEmail}
          onChange={set("contactEmail")}
          error={error("contactEmail")}
        />
      </div>

      {hasFieldErrors && <FormError id="profile-errors" message={t("errors.summary")} />}
      {state.error && <FormError id="profile-error" message={t(`errors.${state.error}`)} />}
      {state.saved && !pending && <FormNotice message={p("saved")} />}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="h-12 rounded-lg border border-input px-6 text-[17px] font-semibold"
        >
          {p("close")}
        </button>
        <Button type="submit" disabled={pending} className="h-12 rounded-lg px-6 text-[17px] font-semibold">
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
