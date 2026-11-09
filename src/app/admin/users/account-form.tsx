"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import { CredentialsBox } from "@/components/credentials-box";
import { FormError, FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import type { AccountField } from "@/lib/validation/user";
import { designationsOf, OFFICE_TYPES, type OfficeType, placeOf, roleOf } from "@/server/auth/designations";
import type { AccountDetails, DistrictChoice, PlaceChoice } from "@/server/users/queries";
import type { AccountFormState } from "./actions";

type Values = Record<AccountField, string>;

const EMPTY: AccountFormState = { errors: {}, error: null, created: null };

const isOfficeType = (value: string): value is OfficeType => (OFFICE_TYPES as readonly string[]).includes(value);

function startValues(account: AccountDetails | null): Values {
  return {
    name: account?.name ?? "",
    mobile: account?.mobile ?? "",
    contactEmail: account?.contactEmail ?? "",
    // A new account has no office type until the admin chooses one (change 0005, design).
    officeType: account?.officeType ?? "",
    designation: account?.designation ?? "",
    dsOfficeId: account?.dsOfficeId ? String(account.dsOfficeId) : "",
    districtId: account?.districtId ? String(account.districtId) : "",
    provinceId: account?.provinceId ? String(account.provinceId) : "",
  };
}

const card = (checked: boolean) =>
  `flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3.5 ${checked ? "border-primary bg-accent" : "border-border bg-card"}`;

/**
 * ADM-2, ADM-4 and ADM-8: the account form. The office type decides which designations it offers and
 * which place it asks for; the server checks the same rules and sets the role from the designation.
 */
export function AccountForm({
  account,
  districts,
  provinces,
  action,
}: {
  account: AccountDetails | null;
  districts: DistrictChoice[];
  provinces: PlaceChoice[];
  action: (state: AccountFormState, form: FormData) => Promise<AccountFormState>;
}) {
  const t = useTranslations("users");
  const [state, formAction, pending] = useActionState(action, EMPTY);
  // Controlled fields keep what was typed when the server sends the form back with errors.
  const [values, setValues] = useState<Values>(() => startValues(account));
  const set = (field: AccountField) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  if (state.created) {
    return (
      <section aria-labelledby="created-title" className="flex max-w-xl flex-col gap-4 rounded-xl border bg-card p-8">
        <h2 id="created-title" className="text-[22px] font-bold">
          {t("created.title")}
        </h2>
        <p className="text-muted-foreground">{t("created.text", { name: state.created.label })}</p>
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
  const officeType = isOfficeType(values.officeType) ? values.officeType : null;
  const place = officeType ? placeOf(officeType) : null;
  const district = districts.find((d) => String(d.id) === values.districtId);

  // Sent from onSubmit, not <form action>: React resets a form after its action, which unticks the
  // controlled radios while the state still holds them.
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  const chooseOfficeType = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    // A designation of the old office type would be refused (ADM-8), so the choice starts again.
    setValues((current) => ({
      ...current,
      officeType: next,
      designation:
        isOfficeType(next) && designationsOf(next).some((d) => d === current.designation) ? current.designation : "",
    }));
  };

  const fieldError = (field: AccountField) =>
    error(field) && (
      <p id={`${field}-error`} className="text-[15px] font-medium text-destructive">
        {error(field)}
      </p>
    );

  const select = (field: "districtId" | "provinceId", label: string, choices: PlaceChoice[], name?: string) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name ?? `${field}-choice`} className="text-base font-semibold">
        {label}
      </label>
      <select
        id={name ?? `${field}-choice`}
        name={name}
        value={values[field]}
        aria-invalid={error(field) ? true : undefined}
        aria-describedby={error(field) ? `${field}-error` : undefined}
        onChange={(event) => setValues((v) => ({ ...v, [field]: event.target.value, dsOfficeId: "" }))}
        className="h-12 w-80 rounded-lg border border-input bg-card px-3 text-[17px]"
      >
        <option value="">{t("form.choose")}</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6" noValidate>
      <fieldset className="flex flex-col gap-2" aria-describedby={error("officeType") ? "officeType-error" : undefined}>
        <legend className="mb-2 text-base font-semibold">{t("form.officeType")}</legend>
        <div className="grid grid-cols-3 gap-3">
          {OFFICE_TYPES.map((type) => {
            const checked = values.officeType === type;
            return (
              <label key={type} className={card(checked)}>
                <input
                  type="radio"
                  name="officeType"
                  value={type}
                  checked={checked}
                  onChange={chooseOfficeType}
                  className="mt-1 size-5 shrink-0 accent-primary"
                />
                <span className="text-base font-bold">{t(`officeTypes.${type}`)}</span>
              </label>
            );
          })}
        </div>
        {fieldError("officeType")}
      </fieldset>

      {officeType && officeType !== "ADMINISTRATOR" && (
        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={error("designation") ? "designation-error" : undefined}
        >
          <legend className="mb-2 text-base font-semibold">{t("form.designation")}</legend>
          <div className="grid grid-cols-2 gap-3">
            {designationsOf(officeType).map((designation) => {
              const checked = values.designation === designation;
              return (
                <label key={designation} className={card(checked)}>
                  <input
                    type="radio"
                    name="designation"
                    value={designation}
                    checked={checked}
                    onChange={set("designation")}
                    className="mt-1 size-5 shrink-0 accent-primary"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-base font-bold">{t(`designations.${designation}`)}</span>
                    <span className="text-sm text-muted-foreground">{t(`roleHints.${roleOf(designation)}`)}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {fieldError("designation")}
        </fieldset>
      )}

      {place === "dsOffice" && (
        <div className="flex flex-col gap-4 rounded-lg bg-muted p-4">
          {/* The district only narrows the list of offices; a DS account belongs to its office alone. */}
          {select("districtId", t("form.district"), districts)}
          {district && (
            <fieldset
              className="flex flex-col gap-2"
              aria-describedby={`office-rule${error("dsOfficeId") ? " dsOfficeId-error" : ""}`}
            >
              <legend className="mb-2 text-base font-semibold">{t("form.office")}</legend>
              <p id="office-rule" className="text-[15px] text-muted-foreground">
                {t("form.severalOfficers")}
              </p>
              <div className="flex flex-wrap gap-2">
                {district.offices.map((o) => {
                  const checked = values.dsOfficeId === String(o.id);
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
                        {!o.active && ` · ${t("form.inactiveOffice")}`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          {fieldError("dsOfficeId")}
        </div>
      )}
      {place === "district" && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-4">
          {select("districtId", t("form.district"), districts, "districtId")}
          {fieldError("districtId")}
        </div>
      )}
      {place === "province" && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-4">
          {select("provinceId", t("form.province"), provinces, "provinceId")}
          {fieldError("provinceId")}
        </div>
      )}
      {(officeType === "DEPARTMENT" || officeType === "MINISTRY") && (
        <p className="rounded-lg bg-muted px-4 py-3 text-[15px]">{t("form.allAreas")}</p>
      )}
      {officeType === "ADMINISTRATOR" && (
        <p className="rounded-lg bg-muted px-4 py-3 text-[15px]">{t("form.adminNote")}</p>
      )}

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
          help={t("form.contactEmailHint")}
          value={values.contactEmail}
          onChange={set("contactEmail")}
          error={error("contactEmail")}
        />
      </div>

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
