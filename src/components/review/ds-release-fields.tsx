"use client";

import { useTranslations } from "next-intl";
import { FormField, FormTextArea } from "@/components/forms/form-field";
import type { DsReleaseDateLimits, DsReleaseErrors, DsReleaseField } from "@/lib/validation/ds-release";

export type DsReleaseFormValues = Record<DsReleaseField, string>;

/**
 * The District release's own fields (REL-6): its reference number and date in one row, then `children`
 * (the scan, when recording), then the note. Used to record a release and to correct one (REL-8).
 */
export function DsReleaseFields({
  idPrefix,
  values,
  onChange,
  errors,
  limits,
  children,
}: {
  idPrefix: string;
  values: DsReleaseFormValues;
  onChange: (field: DsReleaseField, value: string) => void;
  errors: DsReleaseErrors;
  limits: DsReleaseDateLimits;
  children?: React.ReactNode;
}) {
  const t = useTranslations("review");
  const id = (field: DsReleaseField) => `${idPrefix}-${field}`;
  const set = (field: DsReleaseField) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange(field, event.target.value);
  const errorText = (field: DsReleaseField) => {
    const key = errors[field];
    return key ? t(`errors.${key}`) : undefined;
  };

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start gap-4">
        <FormField
          id={id("referenceNumber")}
          label={t("district.reference")}
          help={t("district.referenceHelp")}
          value={values.referenceNumber}
          onChange={set("referenceNumber")}
          autoComplete="off"
          error={errorText("referenceNumber")}
        />
        <FormField
          id={id("releasedOn")}
          type="date"
          label={t("district.date")}
          min={limits.earliest ?? undefined}
          max={limits.today}
          value={values.releasedOn}
          onChange={set("releasedOn")}
          error={errorText("releasedOn")}
        />
      </div>
      {children}
      <FormTextArea
        id={id("note")}
        label={t("letters.note")}
        value={values.note}
        onChange={set("note")}
        error={errorText("note")}
      />
    </>
  );
}
