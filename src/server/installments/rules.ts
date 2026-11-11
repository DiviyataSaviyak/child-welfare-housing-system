import type { InstallmentStatus } from "@/generated/prisma/enums";

/**
 * The order of the four installments (INS-2 to INS-6), as pure rules. The commands apply them on the
 * server whatever the screen showed (ERR-7, AC-11), and the case page uses them to choose its buttons.
 */

export type InstallmentState = { number: number; status: InstallmentStatus; releasedOn: string | null };

/** What the DS office does to an installment: start its payment (INS-3) or mark it paid (INS-4). */
export type Step = "start" | "pay";

export type StepRefusal =
  /** An earlier installment isn't paid yet (INS-2). */
  | "notNext"
  /** Already paid; only the Ministry can undo that (INS-6). */
  | "alreadyPaid"
  /** Starting a payment that is already started. */
  | "alreadyStarted"
  /** Marking paid a payment that hasn't been started (INS-3 comes first). */
  | "notStartedYet"
  /** There is no installment with that number. */
  | "noSuchInstallment";

/** INS-2: the lowest-numbered installment not yet released, the only one that can change; null when all are paid. */
export function nextInstallment<T extends InstallmentState>(list: readonly T[]): T | null {
  return [...list].sort((a, b) => a.number - b.number).find((i) => i.status !== "RELEASED") ?? null;
}

/** Why `step` can't be taken on installment `number` now, or null when it can. */
export function stepRefusal(list: readonly InstallmentState[], number: number, step: Step): StepRefusal | null {
  const target = list.find((i) => i.number === number);
  if (!target) return "noSuchInstallment";
  if (target.status === "RELEASED") return "alreadyPaid";
  if (nextInstallment(list)?.number !== number) return "notNext";
  if (step === "start" && target.status !== "NOT_STARTED") return "alreadyStarted";
  if (step === "pay" && target.status !== "PROCESSING") return "notStartedYet";
  return null;
}

/** INS-4: the day the installment before this one was paid; null for the first. */
export function previousPaidOn(list: readonly InstallmentState[], number: number): string | null {
  return list.find((i) => i.number === number - 1)?.releasedOn ?? null;
}

/** INS-6: the most recently released installment, the only one the Ministry may move back; null when none is paid. */
export function lastPaid<T extends InstallmentState>(list: readonly T[]): T | null {
  return [...list].sort((a, b) => b.number - a.number).find((i) => i.status === "RELEASED") ?? null;
}
