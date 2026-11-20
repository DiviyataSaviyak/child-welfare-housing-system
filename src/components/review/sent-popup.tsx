"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/modal";

/**
 * REL-10, REL-11: a recorded letter or District release, opened as a pop-up over its list. It is kept in the
 * address (`?open=`), so going back or closing it (the button, Escape) goes to `closeHref`.
 */
export function SentPopup({
  title,
  subtitle,
  closeHref,
  children,
}: {
  title: string;
  subtitle: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("review.sent");
  const router = useRouter();
  const close = () => router.replace(closeHref, { scroll: false });
  return (
    <Modal open onClose={close} labelledBy="sent-popup-title" size="wide">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 id="sent-popup-title" className="text-2xl font-bold">
            {title}
          </h2>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={t("close")}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      {children}
    </Modal>
  );
}
