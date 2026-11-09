import { createTranslator } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { localName, NAMES, type Names } from "@/lib/names";
import en from "../../../messages/en.json";
import si from "../../../messages/si.json";
import ta from "../../../messages/ta.json";
import { DESIGNATIONS, type Designation, isDesignation } from "../auth/designations";

const MESSAGES = { si, ta, en };

/** What accountLabel reads; select it with LABEL_SELECT. */
export type LabelRow = {
  name: string;
  designation: string | null;
  dsOffice: Names | null;
  district: Names | null;
  province: Names | null;
};

export const LABEL_SELECT = {
  name: true,
  designation: true,
  dsOffice: { select: NAMES },
  district: { select: NAMES },
  province: { select: NAMES },
} as const;

const users = (locale: Locale) => createTranslator({ locale, messages: MESSAGES[locale], namespace: "users" });

/** The designations whose label in this language contains the text, for searching accounts with no name. */
export function designationsNamed(text: string, locale: Locale): Designation[] {
  const t = users(locale);
  const wanted = text.toLocaleLowerCase();
  return DESIGNATIONS.filter((d) => t(`designations.${d}`).toLocaleLowerCase().includes(wanted));
}

/**
 * ADM-10: how an account is shown wherever a name would be. An account with no name (ADM-2) shows its
 * designation and place instead, such as "ගණකාධිකාරී, වැලිගම"; a nameless admin shows "පරිපාලක". Two
 * accounts may read the same, but the audit log holds each one's id.
 */
export function accountLabel(account: LabelRow, locale: Locale): string {
  if (account.name) return account.name;
  const t = users(locale);
  const designation = isDesignation(account.designation)
    ? t(`designations.${account.designation}`)
    : account.designation || t("officeTypes.ADMINISTRATOR");
  const place = account.dsOffice
    ? localName(account.dsOffice, locale)
    : account.district
      ? t("districtOf", { district: localName(account.district, locale) })
      : account.province
        ? t("provinceOf", { province: localName(account.province, locale) })
        : null;
  return place ? t("label", { designation, place }) : designation;
}
