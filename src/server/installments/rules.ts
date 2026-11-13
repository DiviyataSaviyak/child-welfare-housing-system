import type { InstallmentStatus } from "@/generated/prisma/enums";
import { INSTALLMENT_COUNT, RELEASE_AMOUNT } from "@/lib/money";
import type { AmountLimit } from "@/lib/validation/progress";
import { isHouseKind, type KindValue } from "@/lib/validation/case";

/**
 * The order of the installments (INS-2 to INS-8), as pure rules. The commands apply them on the server
 * whatever the screen showed (ERR-7, AC-11), and the case page uses them to choose its buttons.
 *
 * A house kind's four installments of Rs. 500,000 are made at the District's release (REL-7). A land kind's
 * are made one at a time, each when the DS starts it with its amount (INS-7); until then the next one is
 * `Upcoming`, which `schedule()` adds to the list so the order rules treat both groups alike.
 */

export type InstallmentState = { number: number; status: InstallmentStatus; releasedOn: string | null };

/** INS-7: a land case's next installment, which has no row until the DS starts it. `amount` is the balance. */
export type Upcoming = { number: number; status: "NOT_STARTED"; releasedOn: null; amount: number; upcoming: true };

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

/** INS-7: what is left of the Rs. 2,000,000 to start: the allocation less the installments already started. */
export function landBalance(list: readonly { amount: number }[]): number {
  return RELEASE_AMOUNT - list.reduce((sum, i) => sum + i.amount, 0);
}

/**
 * INS-7: a land case's next installment to start, or null: for a house kind, once four are started, or once
 * the installments started add up to Rs. 2,000,000.
 */
export function upcomingInstallment(
  kind: KindValue,
  list: readonly (InstallmentState & { amount: number })[],
): Upcoming | null {
  const balance = landBalance(list);
  if (isHouseKind(kind) || list.length >= INSTALLMENT_COUNT || balance <= 0) return null;
  return { number: list.length + 1, status: "NOT_STARTED", releasedOn: null, amount: balance, upcoming: true };
}

/** The case's installments, and for a land kind the next one to start when there is one (INS-1, INS-7). */
export function schedule<T extends InstallmentState & { amount: number }>(
  kind: KindValue,
  list: readonly T[],
): (T | Upcoming)[] {
  const upcoming = upcomingInstallment(kind, list);
  return upcoming ? [...list, upcoming] : [...list];
}

export const isUpcoming = (item: object): item is Upcoming => "upcoming" in item;

/**
 * INS-7, INS-8: the amount a land case's installment `number` may take: up to the balance, plus its own
 * amount when it is already started (a correction). Installment 4 takes exactly that, the whole balance.
 */
export function landAmountLimit(list: readonly { number: number; amount: number }[], number: number): AmountLimit {
  const own = list.find((i) => i.number === number)?.amount ?? 0;
  return { max: landBalance(list) + own, fixed: number === INSTALLMENT_COUNT };
}

/** INS-2: the lowest-numbered installment not yet released, the only one that can change; null when all are paid. */
export function nextInstallment<T extends InstallmentState>(list: readonly T[]): T | null {
  return [...list].sort((a, b) => a.number - b.number).find((i) => i.status !== "RELEASED") ?? null;
}

/** Why `step` can't be taken on installment `number` now, or null when it can. `list` comes from schedule(). */
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
