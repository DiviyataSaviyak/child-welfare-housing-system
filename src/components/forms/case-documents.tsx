"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { FormError } from "@/components/forms/form-field";
import { Modal } from "@/components/modal";
import { DOCUMENT_ACCEPT, documentProblem, MAX_DOCUMENTS, SNIFF_BYTES } from "@/lib/file-types";
import type { CaseCommandError } from "@/server/cases/commands";
import type { UploadError, UploadedFile } from "@/server/files/uploads";

export type UploadProblem = UploadError | "tooManyFiles" | "fileFailed";

/** A file chosen on this form. Once uploaded, it joins the case when the form is saved. */
export type Upload = {
  key: number;
  name: string;
  state: "uploading" | "done" | "refused";
  id?: string;
  problem?: UploadProblem;
};

export type DocumentActions = {
  upload: (form: FormData) => Promise<{ ok: true; value: UploadedFile } | { ok: false; error: UploadError }>;
  removeDocument: (caseId: string, fileId: string) => Promise<{ error: CaseCommandError | null }>;
};

const rowClass = "flex min-h-14 items-center gap-4 rounded-lg border px-4 py-2.5";
const smallButton = "h-11 shrink-0 rounded-lg border px-4 text-[15px] font-semibold";

/**
 * Part 4 of the case form, "other documents" (CASE-2). Each file is checked in the browser and
 * uploaded on its own as soon as it is chosen, so a wrong file is refused with its own message while
 * the others still upload (ERR-5). The server checks every file again.
 */
export function CaseDocuments({
  caseId,
  saved,
  uploads,
  onUploadsChange,
  actions,
}: {
  caseId: string;
  /** Documents already on the case. */
  saved: { id: string; name: string }[];
  uploads: Upload[];
  onUploadsChange: (change: (current: Upload[]) => Upload[]) => void;
  actions: DocumentActions;
}) {
  const t = useTranslations("cases.form");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [removeError, setRemoveError] = useState<CaseCommandError | null>(null);
  const [removePending, startRemove] = useTransition();

  const kept = saved.length + uploads.filter((u) => u.state !== "refused").length;
  const update = (key: number, change: Partial<Upload>) =>
    onUploadsChange((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  async function choose(files: File[]) {
    let room = MAX_DOCUMENTS - kept;
    for (const file of files) {
      nextKey.current += 1;
      const key = nextKey.current;
      const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
      const problem: UploadProblem | null = room <= 0 ? "tooManyFiles" : documentProblem(file.size, head);
      if (problem) {
        onUploadsChange((list) => [...list, { key, name: file.name, state: "refused", problem }]);
        continue;
      }
      room -= 1;
      onUploadsChange((list) => [...list, { key, name: file.name, state: "uploading" }]);
      const form = new FormData();
      form.set("file", file);
      try {
        const result = await actions.upload(form);
        update(key, result.ok ? { state: "done", id: result.value.id } : { state: "refused", problem: result.error });
      } catch {
        update(key, { state: "refused", problem: "fileFailed" });
      }
    }
  }

  function confirmRemove() {
    if (!removing) return;
    startRemove(async () => {
      const result = await actions.removeDocument(caseId, removing.id);
      if (result.error) {
        setRemoveError(result.error);
        return;
      }
      setRemoving(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] text-muted-foreground">{t("documentsHelp")}</p>
      {saved.length + uploads.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t("partDocuments")}>
          {saved.map((doc) => (
            <li key={doc.id} className={rowClass}>
              <span className="flex min-w-0 flex-1 flex-col">
                <a
                  href={`/files/${doc.id}`}
                  target="_blank"
                  rel="noopener"
                  className="truncate font-semibold text-primary underline"
                >
                  {doc.name}
                </a>
                <span className="text-sm text-muted-foreground">{t("attached")}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setRemoveError(null);
                  setRemoving(doc);
                }}
                aria-label={t("removeLabel", { name: doc.name })}
                className={`${smallButton} border-input`}
              >
                {t("remove")}
              </button>
            </li>
          ))}
          {uploads.map((upload) => (
            <li
              key={upload.key}
              className={`${rowClass} ${upload.state === "refused" ? "border-destructive bg-destructive/5" : ""}`}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                {upload.state === "done" && upload.id ? (
                  <a
                    href={`/files/${upload.id}`}
                    target="_blank"
                    rel="noopener"
                    className="truncate font-semibold text-primary underline"
                  >
                    {upload.name}
                  </a>
                ) : (
                  <span className="truncate font-semibold">{upload.name}</span>
                )}
                <span
                  className={`text-sm ${upload.state === "refused" ? "font-medium text-destructive" : "text-muted-foreground"}`}
                >
                  {upload.state === "uploading" && t("uploading")}
                  {upload.state === "done" && t("notSavedYet")}
                  {upload.state === "refused" && upload.problem && t(`errors.${upload.problem}`)}
                </span>
              </span>
              {upload.state !== "uploading" && (
                <button
                  type="button"
                  onClick={() => onUploadsChange((list) => list.filter((u) => u.key !== upload.key))}
                  aria-label={t("removeLabel", { name: upload.name })}
                  className={`${smallButton} border-input`}
                >
                  {t("remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={DOCUMENT_ACCEPT}
        data-testid="document-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Clearing the picker lets the same file be chosen again after it is removed.
          event.target.value = "";
          void choose(files);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={kept >= MAX_DOCUMENTS}
        className={`${smallButton} self-start border-primary text-primary disabled:opacity-50`}
      >
        {t("attach")}
      </button>

      <Modal open={removing !== null} onClose={() => setRemoving(null)} labelledBy="remove-document-title">
        <h2 id="remove-document-title" className="text-[22px] font-bold">
          {t("removeTitle")}
        </h2>
        <p>{t("removeText", { name: removing?.name ?? "" })}</p>
        {removeError && <FormError id="remove-document-error" message={t(`errors.${removeError}`)} />}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setRemoving(null)}
            className="h-12 rounded-lg border border-input px-6 text-[17px] font-semibold"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={confirmRemove}
            disabled={removePending}
            className="h-12 rounded-lg bg-destructive px-6 text-[17px] font-semibold text-destructive-foreground"
          >
            {t("removeConfirm")}
          </button>
        </div>
      </Modal>
    </div>
  );
}
