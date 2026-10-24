import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { FileKind } from "@/generated/prisma/enums";
import { documentProblem, type FileProblem, photoProblem, SNIFF_BYTES, sniffType } from "@/lib/file-types";
import { logError } from "../log";
import { canSeeOffice, caseScope, type Viewer } from "../permissions";
import { processPhoto } from "./images";
import { deleteStoredFile, writeStoredFile } from "./storage";

type Actor = Viewer & { userId: string };

export type UploadedFile = { id: string; name: string };
export type UploadError = FileProblem | "notAllowed";
/** A photo can also be a file that only looks like an image, or one too large to open. */
export type PhotoUploadError = UploadError | "photoUnreadable";

/** An upload that was never saved with a case is removed after a day. */
const UNUSED_UPLOAD_MS = 24 * 60 * 60 * 1000;

/** The name to show for an uploaded file: no folders, no control characters, at most 200 characters. */
export function cleanFileName(raw: string): string {
  const name = (raw.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  return name || "file";
}

/**
 * Stores one uploaded document (CASE-2, SEC-7): its type comes from its contents, it gets a random name
 * in the private folder, and it belongs to the person who uploaded it until a case is saved with it.
 * Each file is checked on its own, so one bad file doesn't stop the others (ERR-5).
 */
export async function uploadDocument(
  db: PrismaClient,
  actor: Actor,
  file: { name: string; bytes: Uint8Array },
): Promise<{ ok: true; value: UploadedFile } | { ok: false; error: UploadError }> {
  if (caseScope(actor).kind === "none") return { ok: false, error: "notAllowed" };
  const problem = documentProblem(file.bytes.length, file.bytes.subarray(0, SNIFF_BYTES));
  if (problem) return { ok: false, error: problem };

  await removeUnusedUploads(db, actor.userId);
  const name = cleanFileName(file.name);
  const mimeType = sniffType(file.bytes.subarray(0, SNIFF_BYTES)) as string;
  return { ok: true, value: await store(db, actor, { kind: "DOCUMENT", name, mimeType, bytes: file.bytes }) };
}

/**
 * Stores one photo of building progress (STG-1, STG-3). Only the DS office records progress
 * (application spec, Roles and permissions). The photo is checked from its contents, then turned
 * upright, resized and saved as a JPEG with no metadata, so its GPS position is never stored; a
 * thumbnail is saved beside it (STG-6).
 * Like a document, it belongs to the person who uploaded it until the stage update is saved with it.
 */
export async function uploadPhoto(
  db: PrismaClient,
  actor: Actor,
  file: { name: string; bytes: Uint8Array },
): Promise<{ ok: true; value: UploadedFile } | { ok: false; error: PhotoUploadError }> {
  if (actor.role !== "DS_OFFICER" || caseScope(actor).kind === "none") return { ok: false, error: "notAllowed" };
  const problem = photoProblem(file.bytes.length, file.bytes.subarray(0, SNIFF_BYTES));
  if (problem) return { ok: false, error: problem };
  const processed = await processPhoto(file.bytes);
  if (!processed) return { ok: false, error: "photoUnreadable" };

  await removeUnusedUploads(db, actor.userId);
  // The stored photo is always a JPEG, so its name says so too.
  const stem = cleanFileName(file.name)
    .replace(/\.[^.]*$/, "")
    .slice(0, 195);
  const photo = { name: `${stem || "photo"}.jpg`, mimeType: "image/jpeg", bytes: processed.photo };
  return { ok: true, value: await store(db, actor, { kind: "PHOTO", ...photo, thumb: processed.thumb }) };
}

/**
 * Stores the scan of an allocation letter (REL-2), a PDF or an image checked like a document. Only Head
 * Office records letters. Like a document, it belongs to the person who uploaded it until the letter is
 * saved with it.
 */
export async function uploadLetterScan(
  db: PrismaClient,
  actor: Actor,
  file: { name: string; bytes: Uint8Array },
): Promise<{ ok: true; value: UploadedFile } | { ok: false; error: UploadError }> {
  if (actor.role !== "HO_OFFICER") return { ok: false, error: "notAllowed" };
  const problem = documentProblem(file.bytes.length, file.bytes.subarray(0, SNIFF_BYTES));
  if (problem) return { ok: false, error: problem };

  await removeUnusedUploads(db, actor.userId);
  const name = cleanFileName(file.name);
  const mimeType = sniffType(file.bytes.subarray(0, SNIFF_BYTES)) as string;
  return { ok: true, value: await store(db, actor, { kind: "LETTER", name, mimeType, bytes: file.bytes }) };
}

/** Writes the file, and a photo's thumbnail, under new random names, then its row. Nothing is left half-saved. */
async function store(
  db: PrismaClient,
  actor: Actor,
  file: { kind: FileKind; name: string; mimeType: string; bytes: Uint8Array; thumb?: Uint8Array },
): Promise<UploadedFile> {
  const id = randomUUID();
  const storedName = randomUUID();
  const thumbName = file.thumb ? randomUUID() : null;
  const written: string[] = [];
  try {
    await writeStoredFile(storedName, file.bytes);
    written.push(storedName);
    if (thumbName && file.thumb) {
      await writeStoredFile(thumbName, file.thumb);
      written.push(thumbName);
    }
    await db.storedFile.create({
      data: {
        id,
        kind: file.kind,
        storedName,
        thumbName,
        originalName: file.name,
        mimeType: file.mimeType,
        size: file.bytes.length,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
        uploadedById: actor.userId,
      },
    });
  } catch (error) {
    for (const name of written) await deleteStoredFile(name);
    throw error;
  }
  return { id, name: file.name };
}

/** Removes the person's uploads that were never saved with a case or a letter, once they are a day old. */
async function removeUnusedUploads(db: PrismaClient, userId: string): Promise<void> {
  const where = {
    uploadedById: userId,
    caseId: null,
    letterId: null,
    uploadedAt: { lt: new Date(Date.now() - UNUSED_UPLOAD_MS) },
  };
  const unused = await db.storedFile.findMany({ where, select: { id: true, storedName: true, thumbName: true } });
  if (unused.length === 0) return;
  await db.storedFile.deleteMany({ where: { id: { in: unused.map((f) => f.id) }, caseId: null, letterId: null } });
  for (const file of unused) {
    for (const name of [file.storedName, file.thumbName]) {
      if (!name) continue;
      await deleteStoredFile(name).catch((error: unknown) =>
        logError("file_delete_failed", error, { fileId: file.id }),
      );
    }
  }
}

export type FileToSend = { storedName: string; originalName: string; mimeType: string };

/**
 * A file the viewer may open (SEC-7): a case's file under the same office rules as the case itself
 * (PRM-1), a letter's scan for anyone who may see one of the letter's cases, or the viewer's own upload
 * that is not on a case or letter yet. Anything else is "not found".
 * `thumb` asks for a photo's thumbnail (STG-6); a document has none.
 */
export async function fileForViewer(
  db: PrismaClient,
  viewer: Actor,
  id: string,
  variant: "file" | "thumb" = "file",
): Promise<FileToSend | null> {
  if (caseScope(viewer).kind === "none") return null;
  const file = await db.storedFile.findUnique({
    where: { id },
    select: {
      storedName: true,
      thumbName: true,
      originalName: true,
      mimeType: true,
      uploadedById: true,
      removedAt: true,
      case: { select: { dsOfficeId: true } },
      letter: { select: { releases: { select: { case: { select: { dsOfficeId: true } } } } } },
    },
  });
  if (!file || file.removedAt) return null;
  const allowed = file.case
    ? canSeeOffice(viewer, file.case.dsOfficeId)
    : file.letter
      ? file.letter.releases.some((release) => canSeeOffice(viewer, release.case.dsOfficeId))
      : file.uploadedById === viewer.userId;
  if (!allowed) return null;
  if (variant === "thumb") {
    return file.thumbName
      ? { storedName: file.thumbName, originalName: file.originalName, mimeType: "image/jpeg" }
      : null;
  }
  return { storedName: file.storedName, originalName: file.originalName, mimeType: file.mimeType };
}
