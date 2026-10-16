import { getTranslations } from "next-intl/server";
import { Mark } from "@/components/brand/lockup";
import { MinistryBar } from "@/components/brand/ministry-bar";
import { LanguagePicker } from "@/components/language-picker";

/**
 * Sign-in and password pages, with no menu: the ministry's letterhead across the top (emblem and its
 * name in three languages, as on its website), then the programme's panel in the header's green beside
 * the form (a short band above it on a narrow screen). The language picker sits in the card, beside the form.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("app");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <MinistryBar />
      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="relative isolate shrink-0 overflow-hidden bg-header bg-[linear-gradient(160deg,#11705d_0%,var(--header)_42%,#093d33_100%)] text-header-foreground lg:flex lg:w-[46%] lg:max-w-[680px] lg:flex-col">
          <PanelBackground />
          <div aria-hidden="true" className="h-1 bg-[linear-gradient(90deg,var(--gold),#f0c661_50%,var(--gold))]" />

          {/* A narrow screen: the mark and the name in one short band. */}
          <div className="flex items-center gap-4 px-5 py-4 sm:px-8 lg:hidden">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white shadow-[0_4px_14px_rgb(0_0_0/0.25)] ring-1 ring-white/50">
              <Mark className="h-[34px] w-auto" />
            </span>
            <p className="min-w-0 text-[22px] leading-tight font-bold tracking-tight">{t("name")}</p>
          </div>

          {/* A wide screen: the programme in the middle. */}
          <div className="hidden flex-1 flex-col px-12 py-10 lg:flex xl:px-16 short:py-7">
            <div className="flex flex-1 flex-col justify-center gap-5 py-10 animate-in duration-700 fade-in slide-in-from-bottom-2 motion-reduce:animate-none short:gap-4 short:py-6">
              {/* The mark sits centred over the name, both as wide as the name. */}
              <div className="flex w-fit flex-col items-center gap-7 short:gap-5">
                <span className="relative flex size-[120px] -translate-y-6 items-center justify-center rounded-[30px] bg-white shadow-[0_18px_40px_-12px_rgb(0_0_0/0.45)] ring-1 ring-white/60 short:size-[88px] short:-translate-y-3 short:rounded-3xl">
                  {/* A soft halo round the mark. */}
                  <span
                    aria-hidden="true"
                    className="absolute -inset-3 -z-10 rounded-[36px] bg-white/10 ring-1 ring-white/15"
                  />
                  <Mark className="h-[84px] w-auto short:h-[62px]" />
                </span>
                <p className="text-[40px] leading-[1.15] font-extrabold tracking-tight xl:text-5xl xl:leading-[1.12]">
                  {t("name")}
                </p>
              </div>
              <div className="flex flex-col gap-5 short:gap-4">
                <span aria-hidden="true" className="flex items-center gap-1.5">
                  <span className="h-1.5 w-14 rounded-full bg-gold" />
                  <span className="h-1.5 w-3 rounded-full bg-gold/60" />
                  <span className="size-1.5 rounded-full bg-gold/35" />
                </span>
                <p className="max-w-[30rem] text-[17px] leading-relaxed text-white/80">{t("description")}</p>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex flex-1 flex-col items-center justify-start px-4 py-8 sm:px-8 sm:py-12 lg:justify-center lg:py-10 short:lg:py-4">
          <div className="auth-card w-full max-w-[460px] rounded-3xl border border-black/[0.06] bg-card p-6 shadow-[0_1px_2px_rgb(28_36_32/0.05),0_10px_28px_-10px_rgb(28_36_32/0.14),0_32px_64px_-32px_rgb(14_90_75/0.3)] animate-in duration-500 fade-in slide-in-from-bottom-3 motion-reduce:animate-none sm:p-9 short:lg:py-6">
            <div className="mb-6 flex justify-end short:mb-3">
              <LanguagePicker tone="page" />
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/** The panel's quiet decoration: a light from the top, a fading dot grid, two rings and the house in outline. */
function PanelBackground() {
  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgb(255_255_255/0.14),transparent_55%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.08)_1px,transparent_1px)] mask-[linear-gradient(170deg,black,transparent_70%)] bg-size-[24px_24px]" />
      <div className="absolute -top-48 -right-48 hidden size-[520px] rounded-full border border-white/[0.07] lg:block" />
      <div className="absolute -top-28 -right-28 hidden size-[360px] rounded-full border border-white/[0.06] lg:block" />
      {/* Its size and faintness are attributes, not classes, so it can never fill the panel in solid white. */}
      <svg
        viewBox="0 0 96 88"
        width="480"
        height="440"
        className="auth-watermark"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.06"
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 43 L48 7 L89 43" />
        <path d="M20.75 46 V66 M75.25 46 V66 M48 46 V71 M9 80.5 H87" />
        <path d="M48.5 53 C50 41 55 33 65 30 C65.5 42 59 51 48.5 53 Z" />
        <path d="M47.5 59 C44 50 39.5 44 31.5 41.5 C31 51 37 57.5 47.5 59 Z" />
      </svg>
    </div>
  );
}
