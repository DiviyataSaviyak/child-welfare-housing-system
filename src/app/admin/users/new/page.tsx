import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import { officeChoices, provinceChoices } from "@/server/users/queries";
import { AccountForm } from "../account-form";
import { createAccountAction } from "../actions";

export default async function NewAccountPage() {
  await requireRole("ADMIN");
  const locale = await getLocale();
  const [t, districts, provinces] = await Promise.all([
    getTranslations("users.form"),
    officeChoices(db, locale),
    provinceChoices(db, locale),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] leading-snug font-bold">{t("newTitle")}</h1>
      <AccountForm account={null} districts={districts} provinces={provinces} action={createAccountAction} />
    </div>
  );
}
