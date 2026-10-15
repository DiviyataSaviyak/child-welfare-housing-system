import { getTranslations } from "next-intl/server";
import { Mark } from "@/components/brand/lockup";
import { LanguagePicker } from "@/components/language-picker";

/**
 * Sign-in and password pages, with no menu: the programme's panel in the header's green beside the form
 * (above it on a narrow screen), and the language picker over the form.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("app");

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="relative isolate shrink-0 overflow-hidden bg-header bg-[linear-gradient(150deg,#0f6553_0%,var(--header)_45%,#0a3f34_100%)] text-header-foreground lg:flex lg:w-[44%] lg:max-w-[640px] lg:flex-col">
        <div aria-hidden="true" className="h-1 bg-gold" />
        {/* A soft light and a faint dotted grid behind the panel's words. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_15%,rgb(255_255_255/0.12),transparent_45%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(rgb(255_255_255/0.07)_1px,transparent_1px)] [background-size:22px_22px]"
        />
        <div className="flex items-center gap-4 px-6 py-5 sm:px-10 lg:flex-1 lg:flex-col lg:items-start lg:justify-center lg:gap-8 lg:px-14 lg:py-16">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#fbf5ea] shadow-[0_8px_24px_rgb(0_0_0/0.25)] ring-1 ring-white/40 lg:size-24 lg:rounded-3xl">
            <Mark className="h-9 w-[40px] lg:h-16 lg:w-[70px]" />
          </span>
          <div className="flex min-w-0 flex-col gap-1 lg:gap-5">
            <p className="text-2xl leading-tight font-extrabold tracking-tight lg:text-4xl xl:text-[44px]">
              {t("name")}
            </p>
            <span aria-hidden="true" className="hidden h-1.5 w-20 rounded-full bg-gold lg:block" />
            <p className="text-sm text-header-muted lg:text-lg lg:font-semibold lg:text-header-foreground">
              {t("ministry")}
            </p>
            <p className="hidden max-w-md text-base leading-relaxed text-header-muted lg:block">{t("description")}</p>
          </div>
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <div className="flex justify-center px-4 pt-5 sm:justify-end sm:px-8">
          <LanguagePicker tone="page" />
        </div>
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8 lg:py-12">
          <div className="w-full max-w-[440px] rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgb(28_36_32/0.04),0_12px_32px_-12px_rgb(28_36_32/0.18)] sm:p-9">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
