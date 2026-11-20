"use client";

import { ChevronDown, UserRound } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Modal } from "@/components/modal";
import type { Profile } from "@/server/users/queries";
import { updateProfileAction } from "./actions";
import { ProfileForm } from "./profile-form";

/**
 * The name in the header, which opens the user's profile in a pop-up: the username, office type,
 * designation, role and place to read, and their own details to change, any of which may be left empty
 * (ADM-11). Only the admin changes the rest (ADM-4). An account with no name shows its designation and
 * place in the header instead (ADM-10).
 */
export function ProfileDialog({ userName, profile }: { userName: string; profile: Profile }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  // Each opening starts a fresh form from the saved details, with no old notice or errors.
  const [round, setRound] = useState(0);
  const show = () => {
    setRound((n) => n + 1);
    setOpen(true);
  };

  const { place } = profile;
  const facts = [
    { label: t("profile.username"), value: profile.username },
    { label: t("profile.officeType"), value: t(`users.officeTypes.${profile.officeType}`) },
    ...(profile.designation
      ? [{ label: t("profile.designation"), value: t(`users.designations.${profile.designation}`) }]
      : []),
    { label: t("profile.role"), value: t(`users.roles.${profile.role}`) },
    ...(place?.kind === "dsOffice"
      ? [
          { label: t("profile.district"), value: place.district },
          { label: t("profile.office"), value: place.office },
        ]
      : []),
    ...(place?.kind === "district" ? [{ label: t("profile.district"), value: place.district }] : []),
    ...(place?.kind === "province" ? [{ label: t("profile.province"), value: place.province }] : []),
  ];

  return (
    <>
      <button
        type="button"
        onClick={show}
        title={t("shell.profile")}
        aria-label={`${t("shell.signedInAs")} ${userName} · ${t("shell.profile")}`}
        aria-haspopup="dialog"
        className="flex h-[42px] shrink-0 items-center gap-2.5 rounded-full bg-white/90 ps-1 pe-3 text-[15px] font-bold whitespace-nowrap text-[#1f2e3a] shadow-[0_2px_8px_rgb(20_60_40/0.10)] ring-1 ring-black/[0.06] transition-colors ring-inset hover:bg-white dark:bg-white/[0.07] dark:text-foreground dark:shadow-none dark:ring-white/10 dark:hover:bg-white/[0.12]"
      >
        <span
          aria-hidden="true"
          className="flex size-[34px] items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#2e7a5f,#094f37_70%)] text-white"
        >
          <UserRound className="size-5" />
        </span>
        {userName}
        <ChevronDown aria-hidden="true" className="size-4 text-[#1f2e3a] dark:text-foreground" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy="profile-title" size="wide">
        <h2 id="profile-title" className="text-[22px] font-bold">
          {t("profile.title")}
        </h2>

        <section aria-labelledby="profile-account" className="flex flex-col gap-3 rounded-lg bg-muted p-4">
          <h3 id="profile-account" className="text-lg font-bold">
            {t("profile.accountTitle")}
          </h3>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
            {facts.map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-base text-muted-foreground">{fact.label}</dt>
                <dd className="text-base font-semibold">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="profile-details" className="flex flex-col gap-4">
          <h3 id="profile-details" className="text-lg font-bold">
            {t("profile.detailsTitle")}
          </h3>
          <ProfileForm key={round} profile={profile} action={updateProfileAction} onClose={() => setOpen(false)} />
        </section>

        <Link
          href="/change-password"
          onClick={() => setOpen(false)}
          className="text-base font-semibold text-primary underline underline-offset-4"
        >
          {t("shell.changePassword")}
        </Link>
      </Modal>
    </>
  );
}
