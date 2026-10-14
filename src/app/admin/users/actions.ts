"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type AccountErrors, parseAccountForm } from "@/lib/validation/user";
import { requireRole } from "@/server/context";
import { db } from "@/server/db";
import {
  type AccountCommandError,
  type Credentials,
  createAccount,
  resetPassword,
  setAccountDisabled,
  updateAccount,
} from "@/server/users/commands";

export type AccountFormState = {
  errors: AccountErrors;
  error: AccountCommandError | null;
  /** Set once, after a successful create: shown to the admin a single time (AUTH-6). */
  created: (Credentials & { name: string }) | null;
};

const read = (form: FormData) => (field: string) => {
  const value = form.get(field);
  return typeof value === "string" ? value : "";
};

export async function createAccountAction(_previous: AccountFormState, form: FormData): Promise<AccountFormState> {
  const admin = await requireRole("ADMIN");
  const parsed = parseAccountForm(read(form));
  if (!parsed.ok) return { errors: parsed.errors, error: null, created: null };

  const result = await createAccount(db, admin.userId, parsed.value);
  if (!result.ok) return { errors: {}, error: result.error, created: null };

  revalidatePath("/admin/users");
  return { errors: {}, error: null, created: { ...result.value, name: parsed.value.name } };
}

export async function updateAccountAction(
  id: string,
  _previous: AccountFormState,
  form: FormData,
): Promise<AccountFormState> {
  const admin = await requireRole("ADMIN");
  const parsed = parseAccountForm(read(form));
  if (!parsed.ok) return { errors: parsed.errors, error: null, created: null };

  const result = await updateAccount(db, admin.userId, id, parsed.value);
  if (!result.ok) return { errors: {}, error: result.error, created: null };

  revalidatePath("/admin/users");
  redirect(`/admin/users?notice=${result.value.changed.includes("dsOfficeId") ? "transferred" : "saved"}`);
}

export type ResetState = { error: AccountCommandError | null; credentials: Credentials | null };

export async function resetPasswordAction(id: string): Promise<ResetState> {
  const admin = await requireRole("ADMIN");
  const result = await resetPassword(db, admin.userId, id);
  if (!result.ok) return { error: result.error, credentials: null };
  revalidatePath("/admin/users");
  return { error: null, credentials: result.value };
}

export type DisableState = { error: AccountCommandError | null; done: boolean };

/** `disabled` true turns the account off. The pop-up passes the row's `active` flag, so each click flips it. */
export async function setDisabledAction(id: string, disabled: boolean): Promise<DisableState> {
  const admin = await requireRole("ADMIN");
  const result = await setAccountDisabled(db, admin.userId, id, disabled);
  if (!result.ok) return { error: result.error, done: false };
  revalidatePath("/admin/users");
  return { error: null, done: true };
}
