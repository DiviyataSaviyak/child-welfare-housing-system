"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "./locales";

/**
 * UI-9: remembers the chosen language in this browser and shows the screen again in it. Anyone may
 * call it, signed in or not, because the sign-in page has the same choice.
 */
export async function chooseLanguage(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    // The server is reached over HTTPS while it is staging too, not only in production.
    secure: process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
  });
  // Layouts hold the menu and the header, and don't render again on their own.
  revalidatePath("/", "layout");
}
