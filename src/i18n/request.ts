import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { isLocale, LOCALE_COOKIE, readLocale } from "./locales";

export const TIME_ZONE = "Asia/Colombo";

/**
 * Each request's language comes from the browser's cookie (UI-9): Sinhala, Tamil or English, with
 * Sinhala when none is chosen. Addresses carry no language, so every link and bookmark works in all three.
 * A server component that asks for one language by name (`getTranslations({ locale })`, as the ministry's
 * letterhead does for its three names) gets that one instead.
 */
export default getRequestConfig(async ({ locale: asked }) => {
  const locale = isLocale(asked) ? asked : readLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    locale,
    timeZone: TIME_ZONE,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
