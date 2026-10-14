"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { CredentialsBox } from "@/components/credentials-box";
import { FormError, FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import type { AccountField } from "@/lib/validation/user";
import { ROLES, type Role } from "@/server/auth/roles";
import type { AccountDetails, DistrictChoice } from "@/server/users/queries";
import type { AccountFormState } from "./actions";

type Values = Record<AccountField, string> & { districtId: string };

const EMPTY: AccountFormState = { errors: {}, error: null, created: null };

function startValues(account: AccountDetails | null): Values {
  return {
    name: account?.name ?? "",
    designation: account?.designation ?? "",
    mobile: account?.mobile ?? "",
    contactEmail: account?.contactEmail ?? "",
    role: account?.role ?? "",
    dsOfficeId: account?.dsOfficeId ? String(account.dsOfficeId) : "",
    districtId: account?.districtId ? String(account.districtId) : "",
  };
}

/** ADM-2 and ADM-4: the account form, in the prototype's layout. */
export function AccountForm({
  account,
  districts,
  action,
}: {
  account: AccountDetails | null;
  districts: DistrictChoice[];
  action: (state: AccountFormState, form: FormData) => Promise<AccountFormState>;
}) {
  const t = useTranslations("users");
  const [state, formAction, pending] = useActionState(action, EMPTY);
  // Controlled fields keep what was typed when the server sends the form back with errors.
  const [values, setValues] = useState<Values>(() => startValues(account));
  const set = (field: keyof Values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  if (state.created) {
    return (
      <section aria-labelledby="created-title" className="flex max-w-xl flex-col gap-4 rounded-xl border bg-card p-8">
        <h2 id="created-title" className="text-[22px] font-bold">
          {t("created.title")}
        </h2>
        <p className="text-muted-foreground">{t("created.text", { name: state.created.name })}</p>
        <CredentialsBox username={state.created.username} temporaryPassword={state.created.temporaryPassword} />
        <p className="text-[15px]">{t("created.handOver")}</p>
        <div className="flex gap-3">
          <Link
            href="/admin/users"
            className="flex h-12 items-center rounded-lg bg-primary px-6 text-[17px] font-semibold text-primary-foreground"
          >
            {t("created.backToList")}
          </Link>
          <a
            href="/admin/users/new"
            className="flex h-12 items-center rounded-lg border border-input px-6 text-[17px] font-semibold"
          >
            {t("created.addAnother")}
          </a>
        </div>
      </section>
    );
  }

  const error = (field: AccountField) => {
    const key = state.errors[field];
    return key ? t(`form.errors.${key}`) : undefined;
  };
  const hasFieldErrors = Object.keys(state.errors).length > 0;
  const district = districts.find((d) => String(d.id) === values.districtId);

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-6" noValidate>
      <div className="grid grid-cols-2 gap-5">
        <FormField
          id="name"
          name="name"
          label={t("form.name")}
          value={values.name}
          onChange={set("name")}
          error={error("name")}
        />
        <FormField
          id="designation"
          name="designation"
          label={t("form.designation")}
          help={t("form.designationHint")}
          value={values.designation}
          onChange={set("designation")}
          error={error("designation")}
        />
        <FormField
          id="mobile"
          name="mobile"
          type="tel"
          label={t("form.mobile")}
          value={values.mobile}
          onChange={set("mobile")}
          error={error("mobile")}
        />
        <FormField
          id="contactEmail"
          name="contactEmail"
          type="email"
          label={t("form.contactEmail")}
          value={values.contactEmail}
          onChange={set("contactEmail")}
          error={error("contactEmail")}
        />
      </div>

      <fieldset className="flex flex-col gap-2" aria-describedby={error("role") ? "role-error" : undefined}>
        <legend className="mb-2 text-base font-semibold">{t("form.role")}</legend>
        <div className="grid grid-cols-3 gap-3">
          {ROLES.map((role: Role) => {
            const checked = values.role === role;
            return (
              <label
                key={role}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3.5 ${checked ? "border-primary bg-accent" : "border-border bg-card"}`}
              >
                <input
                  type="radio"
                  name="role"
                  value={role}
                  checked={checked}
                  onChange={set("role")}
                  className="mt-1 size-5 shrink-0 accent-primary"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-base font-bold">{t(`roles.${role}`)}</span>
                  <span className="text-sm text-muted-foreground">{t(`roleHints.${role}`)}</span>
                </span>
              </label>
            );
          })}
        </div>
        {error("role") && (
          <p id="role-error" className="text-[15px] font-medium text-destructive">
            {error("role")}
          </p>
        )}
      </fieldset>

      {values.role === "DS_OFFICER" && (
        <div className="flex flex-col gap-4 rounded-lg bg-muted p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="districtId" className="text-base font-semibold">
              {t("form.district")}
            </label>
            <select
              id="districtId"
              value={values.districtId}
              onChange={(event) => setValues((v) => ({ ...v, districtId: event.target.value, dsOfficeId: "" }))}
              className="h-12 w-80 rounded-lg border border-input bg-card px-3 text-[17px]"
            >
              <option value="">{t("form.chooseDistrict")}</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          {district && (
            <fieldset
              className="flex flex-col gap-2"
              aria-describedby={`office-rule${error("dsOfficeId") ? " office-error" : ""}`}
            >
              <legend className="mb-2 text-base font-semibold">{t("form.office")}</legend>
              <p id="office-rule" className="text-[15px] text-muted-foreground">
                {t("form.officersShown")}
              </p>
              <div className="flex flex-wrap gap-2">
                {district.offices.map((o) => {
                  const checked = values.dsOfficeId === String(o.id);
                  // ADM-3: an office can have several officers; the names show who already has an account.
                  const others = o.officers.filter((officer) => officer.id !== account?.id);
                  return (
                    <label
                      key={o.id}
                      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border-2 px-3.5 py-1.5 ${
                        checked ? "border-primary bg-accent" : "border-border bg-card"
                      }`}
                    >
                      <input
                        type="radio"
                        name="dsOfficeId"
                        value={o.id}
                        checked={checked}
                        onChange={set("dsOfficeId")}
                        className="size-[18px] accent-primary"
                      />
                      <span className="text-base">
                        {o.name}
                        {others.length > 0 && ` · ${others.map((officer) => officer.name).join(", ")}`}
                        {!o.active && ` · ${t("form.inactiveOffice")}`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          {error("dsOfficeId") && (
            <p id="office-error" className="text-[15px] font-medium text-destructive">
              {error("dsOfficeId")}
            </p>
          )}
        </div>
      )}
      {(values.role === "HO_OFFICER" || values.role === "ADMIN") && (
        <p className="rounded-lg bg-muted px-4 py-3 text-[15px]">{t("form.headOfficeNote")}</p>
      )}

      {hasFieldErrors && <FormError id="account-errors" message={t("form.errors.summary")} />}
      {state.error && <FormError id="account-error" message={t(`form.errors.${state.error}`)} />}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending} className="h-12 rounded-lg px-6 text-[17px] font-semibold">
          {pending ? t("form.saving") : account ? t("form.save") : t("form.create")}
        </Button>
        <Link
          href="/admin/users"
          className="flex h-12 items-center rounded-lg border border-input px-6 text-[17px] font-semibold"
        >
          {t("form.cancel")}
        </Link>
      </div>
    </form>
  );
}
