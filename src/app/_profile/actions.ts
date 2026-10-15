"use server";

import { revalidatePath } from "next/cache";
import { type ProfileErrors, parseProfileForm } from "@/lib/validation/user";
import { requireSignedIn } from "@/server/context";
import { db } from "@/server/db";
import { type AccountCommandError, updateProfile } from "@/server/users/commands";

export type ProfileFormState = {
  errors: ProfileErrors;
  error: AccountCommandError | null;
  saved: boolean;
};

const read = (form: FormData) => (field: string) => {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
};

/** Saves the signed-in user's own details. The role, district and DS office are not on the form. */
export async function updateProfileAction(_previous: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const context = await requireSignedIn();
  const parsed = parseProfileForm(read(form));
  if (!parsed.ok) return { errors: parsed.errors, error: null, saved: false };

  const result = await updateProfile(db, context.userId, parsed.value);
  if (!result.ok) return { errors: {}, error: result.error, saved: false };

  // The header shows the name, and a layout doesn't render again by itself.
  revalidatePath("/", "layout");
  return { errors: {}, error: null, saved: true };
}
