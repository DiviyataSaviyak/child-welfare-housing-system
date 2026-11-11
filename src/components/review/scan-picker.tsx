"use client";

import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { DOCUMENT_ACCEPT, documentProblem, SNIFF_BYTES } from "@/lib/file-types";
import type { UploadedFile, UploadError } from "@/server/files/uploads";

export type Scan =
  | { state: "uploading"; name: string }
  | { state: "done"; name: string; id: string }
  | { state: "refused"; name: string; problem: UploadError | "fileFailed" };

export type ScanUpload = (
  form: FormData,
) => Promise<{ ok: true; value: UploadedFile } | { ok: false; error: UploadError }>;

/**
 * A letter's optional scan (REL-2, REL-6): a PDF or an image of up to 10 MB, checked in the browser first,
 * then uploaded as soon as it is chosen. It joins the letter or release when that is saved.
 */
export function ScanPicker({
  scan,
  onChange,
  upload,
}: {
  scan: Scan | null;
  onChange: (scan: Scan | null) => void;
  upload: ScanUpload;
}) {
  const t = useTranslations("review");
  const tf = useTranslations("cases.form");
  const input = useRef<HTMLInputElement>(null);

  async function choose(file: File) {
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const problem = documentProblem(file.size, head);
    if (problem) {
      onChange({ state: "refused", name: file.name, problem });
      return;
    }
    onChange({ state: "uploading", name: file.name });
    const form = new FormData();
    form.set("file", file);
    try {
      const result = await upload(form);
      onChange(
        result.ok
          ? { state: "done", name: file.name, id: result.value.id }
          : { state: "refused", name: file.name, problem: result.error },
      );
    } catch {
      onChange({ state: "refused", name: file.name, problem: "fileFailed" });
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-base font-semibold">{t("letters.scan")}</span>
      {scan && scan.state !== "refused" ? (
        <div className="flex items-center gap-3 rounded-lg border px-3.5 py-2.5">
          <FileText aria-hidden="true" className="size-5.5 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col">
            {scan.state === "done" ? (
              <a
                href={`/files/${scan.id}`}
                target="_blank"
                rel="noopener"
                className="truncate font-semibold text-primary underline"
              >
                {scan.name}
              </a>
            ) : (
              <span className="truncate font-semibold">{scan.name}</span>
            )}
            <span className="text-sm text-muted-foreground">
              {scan.state === "uploading" ? t("letters.scanUploading") : t("letters.scanNotSaved")}
            </span>
          </span>
          {scan.state === "done" && (
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={t("letters.scanRemoveLabel", { name: scan.name })}
              className="h-9.5 shrink-0 rounded-lg border border-input bg-card px-3.5 text-[15px] font-semibold"
            >
              {t("letters.scanRemove")}
            </button>
          )}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="h-11 self-start rounded-lg border border-dashed border-[#8C877C] bg-card px-4 font-semibold"
          >
            {t("letters.scanChoose")}
          </button>
          {scan?.state === "refused" && (
            <p className="text-[15px] font-medium text-destructive">
              {scan.name}: {tf(`errors.${scan.problem}`)}
            </p>
          )}
        </>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept={DOCUMENT_ACCEPT}
        data-testid="letter-scan-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Clearing the picker lets the same file be chosen again after it is removed.
          event.target.value = "";
          if (file) void choose(file);
        }}
      />
    </div>
  );
}

/** A "tick all" box, half ticked when only some of its cases are. */
export function TickAll({
  label,
  ids,
  ticked,
  onChange,
}: {
  label: string;
  ids: string[];
  ticked: ReadonlySet<string>;
  onChange: (ids: string[], on: boolean) => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  const count = ids.filter((id) => ticked.has(id)).length;
  useEffect(() => {
    if (box.current) box.current.indeterminate = count > 0 && count < ids.length;
  }, [count, ids.length]);
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[15px] font-semibold">
      <input
        ref={box}
        type="checkbox"
        checked={count === ids.length}
        onChange={(event) => onChange(ids, event.target.checked)}
        className="size-5 accent-primary"
      />
      {label}
    </label>
  );
}
