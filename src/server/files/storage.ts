import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Uploads are kept outside the web root (ARC-5). On the servers they go to the private S3 bucket named
 * by FILES_BUCKET; the Infrastructure repository sets it, with AWS_REGION and the bucket's credentials
 * (AWS_CONFIG_FILE). Without FILES_BUCKET they go to a private folder: FILES_DIR, or in development
 * data/files in the project, which git ignores. Both hold the same names.
 */
export function filesRoot(): string {
  return process.env.FILES_DIR ?? join(process.cwd(), "data", "files");
}

const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Files sit in 256 sub-folders named after the first two characters of their random name. */
function keyOf(storedName: string): string {
  // Stored names are random UUIDs made by us; anything else would point outside the folder.
  if (!STORED_NAME.test(storedName)) throw new Error("Not a stored file name");
  return `${storedName.slice(0, 2)}/${storedName}`;
}

const pathOf = (storedName: string) => join(filesRoot(), keyOf(storedName));

let s3: S3Client | undefined;

/** The bucket, when FILES_BUCKET names one, and one client for the process. */
function bucket(): { name: string; client: S3Client } | null {
  const name = process.env.FILES_BUCKET;
  if (!name) return null;
  s3 ??= new S3Client({});
  return { name, client: s3 };
}

/** Writes a new file. It refuses to overwrite one, and only the app may read it. */
export async function writeStoredFile(storedName: string, bytes: Uint8Array): Promise<void> {
  const files = bucket();
  if (files) {
    // If-None-Match: S3 refuses the write (412) when the name is taken.
    await files.client.send(
      new PutObjectCommand({ Bucket: files.name, Key: keyOf(storedName), Body: bytes, IfNoneMatch: "*" }),
    );
    return;
  }
  const path = pathOf(storedName);
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
}

export async function readStoredFile(storedName: string): Promise<Buffer> {
  const files = bucket();
  if (!files) return readFile(pathOf(storedName));
  const object = await files.client.send(new GetObjectCommand({ Bucket: files.name, Key: keyOf(storedName) }));
  if (!object.Body) throw new Error("The stored file came back empty");
  const bytes = await object.Body.transformToByteArray();
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Removes a file; one that is already gone is fine. */
export async function deleteStoredFile(storedName: string): Promise<void> {
  const files = bucket();
  if (files) {
    // S3 answers a delete of a missing object as a success.
    await files.client.send(new DeleteObjectCommand({ Bucket: files.name, Key: keyOf(storedName) }));
    return;
  }
  await rm(pathOf(storedName), { force: true });
}
