import { Headset, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Mark } from "@/components/brand/lockup";
import { MinistryBar } from "@/components/brand/ministry-bar";
import { LanguagePicker } from "@/components/language-picker";
import { ThemeToggle } from "@/components/theme/theme-toggle";

/** The number in the footer. It is the design's sample number: put the Ministry's own here before release. */
const SUPPORT_PHONE = "011-1234567";

/**
 * Sign-in and password pages, with no menu: the ministry's letterhead across the top (emblem, its name
 * in three languages and its motto), then the programme's panel beside the form, and a dark green footer.
 * On a wide screen the panel is a picture (green trees, a house in outline, the children, and the curved
 * gold edge, with the page showing through beyond it), with the mark, the name and the description on it;
 * on a narrow screen it is a short green band above the form. The language picker sits at the top of the card.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("app");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <MinistryBar />
      <div className="relative isolate flex flex-1 flex-col bg-[#fafae9] bg-[linear-gradient(180deg,#e9f0d7_0%,#f7f8e5_12%,#fafae9_45%,#f6f8e6_78%,#d6e5b8_100%)] lg:flex-row dark:bg-[#111813] dark:bg-[linear-gradient(180deg,#15201a_0%,#121a15_12%,#111813_45%,#121a15_78%,#16251b_100%)]">
        <aside className="relative isolate shrink-0 overflow-hidden bg-header bg-[linear-gradient(175deg,#0c5b49_0%,#17734f_45%,#2f8a4d_100%)] text-header-foreground lg:flex lg:w-[51.5%] lg:flex-col lg:bg-none lg:bg-transparent">
          {/* A wide screen: the picture fills the panel, keeping its curved right edge and the children at the foot. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 hidden bg-[url(/sign-in-panel.webp)] bg-cover bg-[position:right_bottom] bg-no-repeat lg:block dark:brightness-[0.8]"
          />
          <div
            aria-hidden="true"
            className="h-1 bg-[linear-gradient(90deg,var(--gold),#f0c661_50%,var(--gold))] lg:hidden"
          />

          {/* A narrow screen: the mark and the name in one short band. */}
          <div className="relative flex items-center gap-4 px-5 py-4 sm:px-8 lg:hidden">
            <div
              aria-hidden="true"
              className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_20%_0%,rgb(255_255_255/0.16),transparent_55%)]"
            />
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white shadow-[0_4px_14px_rgb(0_0_0/0.25)] ring-1 ring-white/50">
              <Mark className="h-[34px] w-auto" />
            </span>
            <p className="min-w-0 text-[22px] leading-tight font-bold tracking-tight">{t("name")}</p>
          </div>

          {/* A wide screen: the programme in the upper part, over the trees; the children fill the lower part. */}
          <div className="hidden min-h-0 flex-[11_1_0%] animate-in flex-col justify-center py-8 pr-[14%] pl-[12%] duration-700 fade-in slide-in-from-bottom-2 motion-reduce:animate-none lg:flex xl:pl-[20%] short:py-4">
            <div className="flex w-fit flex-col gap-5 short:gap-3">
              {/* The mark sits centred over the name. */}
              <div className="flex w-fit flex-col items-center gap-7 short:gap-4">
                <span className="relative flex size-[140px] items-center justify-center rounded-[34px] bg-white shadow-[0_18px_40px_-12px_rgb(0_0_0/0.45)] xl:size-[164px] xl:rounded-[38px] short:size-[88px] short:rounded-3xl short:xl:size-[96px]">
                  {/* A soft halo round the mark. */}
                  <span
                    aria-hidden="true"
                    className="absolute -inset-3.5 -z-10 rounded-[44px] bg-white/[0.13] ring-1 ring-white/20 xl:rounded-[48px] short:-inset-2 short:rounded-[28px]"
                  />
                  <Mark className="h-[100px] w-auto xl:h-[118px] short:h-[62px] short:xl:h-[68px]" />
                </span>
                <p className="text-[50px] leading-[1.15] font-extrabold tracking-tight [text-shadow:0_2px_12px_rgb(0_0_0/0.3)] xl:text-[64px] xl:leading-[1.1] short:text-[38px] short:xl:text-[44px]">
                  {t("name")}
                </p>
              </div>
              <span aria-hidden="true" className="flex items-center gap-2">
                <span className="h-[7px] w-[72px] rounded-full bg-[#f2c94c]" />
                <span className="h-[7px] w-3.5 rounded-full bg-[#f2c94c]" />
              </span>
              <p className="max-w-[26rem] text-[19px] leading-relaxed font-medium text-white [text-shadow:0_1px_8px_rgb(0_0_0/0.35)] xl:max-w-[30rem] xl:text-[22px] short:text-base short:xl:text-lg">
                {t("description")}
              </p>
            </div>
          </div>
          <div aria-hidden="true" className="hidden min-h-0 flex-[9_1_0%] lg:block" />
        </aside>

        <main className="relative flex flex-1 flex-col items-center justify-start px-4 py-8 sm:px-8 sm:py-12 lg:justify-center lg:py-5 short:lg:py-3">
          {/* Big faint leaves at the page's right edge, on a wide screen. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sign-in-leaves.webp"
            alt=""
            aria-hidden="true"
            width={272}
            height={1300}
            className="pointer-events-none absolute right-0 bottom-0 -z-10 hidden h-[86%] w-auto lg:block dark:opacity-[0.15]"
          />
          <div className="auth-card w-full max-w-[500px] animate-in rounded-[24px] border border-black/[0.04] dark:border-white/[0.07] bg-card px-6 pt-5 pb-6 shadow-[0_1px_2px_rgb(28_36_32/0.04),0_12px_32px_-10px_rgb(28_36_32/0.16),0_36px_70px_-34px_rgb(14_90_75/0.3)] duration-500 fade-in slide-in-from-bottom-3 motion-reduce:animate-none sm:px-9 short:lg:pt-3 short:lg:pb-4">
            <div className="mb-4 flex flex-wrap items-center justify-center gap-2.5 short:mb-2">
              <LanguagePicker tone="page" />
              <ThemeToggle tone="page" />
            </div>
            {children}
          </div>
        </main>
      </div>

      <footer className="shrink-0 bg-[#07503f] text-[15px] text-white/95 dark:bg-[#0a3a2f]">
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-8 sm:py-[18px] lg:px-11 short:py-2">
          <p className="flex items-center gap-3">
            <ShieldCheck
              aria-hidden="true"
              className="size-7 shrink-0 fill-white stroke-[#07503f] dark:stroke-[#0a3a2f]"
            />
            <span>{t("rights", { year: String(new Date().getFullYear()) })}</span>
          </p>
          <p className="flex items-center gap-3 sm:border-l-2 sm:border-white/85 sm:pl-8">
            <Headset aria-hidden="true" className="size-7 shrink-0" />
            <span>
              {t("support")} :{" "}
              <a
                href={`tel:${SUPPORT_PHONE.replace(/\D/g, "")}`}
                className="font-semibold underline-offset-4 hover:underline"
              >
                {SUPPORT_PHONE}
              </a>
            </span>
          </p>
        </div>
      </footer>
    </div>
  );
}
