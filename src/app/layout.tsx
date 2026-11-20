import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { THEME_SCRIPT } from "@/components/theme/theme-script";
import "./globals.css";

// Noto Sans Sinhala served from this app, never from Google at runtime (UI-4, STK-2).
const sinhala = localFont({
  src: "./fonts/noto-sans-sinhala-sinhala-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-sinhala",
  display: "swap",
});

// Noto Sans Tamil, for the Tamil screens (UI-9), also served from this app.
const tamil = localFont({
  src: "./fonts/noto-sans-tamil-tamil-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-tamil",
  display: "swap",
});

const latin = localFont({
  src: "./fonts/noto-sans-sinhala-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-latin",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: t("name"), description: t("description") };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, so each one gets the proxy's CSP nonce (SEC-5).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const locale = await getLocale();
  return (
    // The head script may add `dark` before React starts, so <html>'s class can differ from the server's.
    <html
      lang={locale}
      className={`${sinhala.variable} ${tamil.variable} ${latin.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Light or dark before the first paint (the sun and moon button); it carries the CSP nonce (SEC-5). */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
