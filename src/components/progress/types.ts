import type { ProgressErrorKey } from "@/lib/validation/progress";
import type { DeleteCaseError } from "@/server/cases/commands";
import type { InstallmentError } from "@/server/installments/commands";
import type { StageError } from "@/server/stages/commands";

/**
 * Every refusal an installment, stage or delete action can answer with; each is a key under
 * "progress.errors".
 */
export type ProgressError = InstallmentError | StageError | DeleteCaseError;

/** What a progress action answers when it refuses. On success it moves on to the case page instead. */
export type ProgressState = {
  error: ProgressError | null;
  errors: Partial<Record<string, ProgressErrorKey>>;
};

export type ProgressAction = (state: ProgressState, form: FormData) => Promise<ProgressState>;
