"use client";

import { UserRound } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Modal } from "@/components/modal";
import type { Profile } from "@/server/users/queries";
import { updateProfileAction } from "./actions";
import { ProfileForm } from "./profile-form";

/**
 * The name in the header, which opens the user's profile in a pop-up: the username, role, district and
 * DS office to read, and their own details to change. Only the admin changes the rest (ADM-4).
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

  const facts = [
    { label: t("profile.username"), value: profile.username },
    { label: t("profile.role"), value: t(`users.roles.${profile.role}`) },
    ...(profile.districtName ? [{ label: t("profile.district"), value: profile.districtName }] : []),
    ...(profile.officeName ? [{ label: t("profile.office"), value: profile.officeName }] : []),
  ];

  return (
    <>
      <button
        type="button"
        onClick={show}
        title={t("shell.profile")}
        aria-label={`${t("shell.signedInAs")} ${userName} · ${t("shell.profile")}`}
        aria-haspopup="dialog"
        className="flex h-10 shrink-0 items-center gap-2.5 rounded-full bg-white/10 ps-1 pe-5 text-[15px] font-semibold whitespace-nowrap ring-1 ring-white/15 transition-colors ring-inset hover:bg-white/20"
      >
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-gold text-foreground"
        >
          <UserRound className="size-[18px]" />
        </span>
        {userName}
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
