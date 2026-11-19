import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { FormNotice } from "@/components/forms/form-field";
import { homeFor } from "@/server/auth/roles";
import { getContext } from "@/server/context";
import { SignInForm } from "./sign-in-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; notice?: string | string[] }>;
}) {
  const context = await getContext();
  if (context) redirect(context.mustChangePassword ? "/change-password" : homeFor(context.role));

  const { next, notice } = await searchParams;
  const t = await getTranslations("login");

  return (
    <div className="flex flex-col gap-5 short:gap-3">
      <div className="flex flex-col items-center gap-2 text-center">
        {/* Two officers over a gold sweep. */}
        <svg aria-hidden="true" viewBox="0 0 96 62" className="mb-1.5 h-[62px] w-auto short:hidden">
          <g fill="#0b5d45" stroke="#fff" strokeWidth="2.5">
            <path d="M18 46C18 33 25 27 34 27S50 33 50 46Z" />
            <circle cx="34" cy="15" r="9.5" />
            <path d="M44 46C44 33 51 27 60 27S76 33 76 46Z" />
            <circle cx="60" cy="15" r="9.5" />
          </g>
          <path d="M2 60C26 44 70 42 94 56C70 50 28 51 2 60Z" fill="#f2c230" />
        </svg>
        <h1 className="text-[30px] leading-snug font-extrabold tracking-tight text-[#0b4c3f] sm:text-[34px] short:text-[28px]">
          {t("title")}
        </h1>
        <p className="max-w-[28rem] text-[17px] leading-relaxed text-[#555b58] short:text-[15px]">{t("intro")}</p>
      </div>
      {/* After a forgotten password was reset with a code sent by email (AUTH-7). */}
      {notice === "passwordReset" && <FormNotice message={t("passwordReset")} />}
      <SignInForm next={typeof next === "string" ? next : ""} />
      <div className="flex justify-center rounded-2xl bg-[#e8f6ee] px-5 py-4 shadow-[0_6px_18px_-12px_rgb(14_90_75/0.35)] short:py-2.5">
        <p className="flex max-w-[26rem] gap-3.5 text-[15.5px] leading-relaxed text-[#1f2a25]">
          <Info aria-hidden="true" className="mt-0.5 size-[22px] shrink-0 fill-[#16a37f] stroke-white" />
          <span>{t("help")}</span>
        </p>
      </div>
    </div>
  );
}
