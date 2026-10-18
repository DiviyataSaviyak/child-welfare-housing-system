import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteStoredFile, readStoredFile, writeStoredFile } from "./storage";

const bytes = new Uint8Array([37, 80, 68, 70]);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("uploads in a private folder (ARC-5), without FILES_BUCKET", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "diviyata-files-"));
    vi.stubEnv("FILES_BUCKET", "");
    vi.stubEnv("FILES_DIR", folder);
  });

  afterEach(() => rm(folder, { recursive: true, force: true }));

  it("writes a file under its first two characters, reads it back and removes it", async () => {
    const name = randomUUID();
    await writeStoredFile(name, bytes);
    expect(await readdir(join(folder, name.slice(0, 2)))).toEqual([name]);
    expect(new Uint8Array(await readStoredFile(name))).toEqual(bytes);

    await deleteStoredFile(name);
    await expect(readStoredFile(name)).rejects.toThrow();
    await expect(deleteStoredFile(name)).resolves.toBeUndefined();
  });

  it("never overwrites a file", async () => {
    const name = randomUUID();
    await writeStoredFile(name, bytes);
    await expect(writeStoredFile(name, new Uint8Array([1]))).rejects.toThrow(/EEXIST/);
  });

  it("refuses a name it didn't make", async () => {
    await expect(writeStoredFile("../../etc/passwd", bytes)).rejects.toThrow("Not a stored file name");
    await expect(readStoredFile("..")).rejects.toThrow("Not a stored file name");
  });
});

describe("uploads in the S3 bucket named by FILES_BUCKET (ARC-5)", () => {
  beforeEach(() => {
    vi.stubEnv("FILES_BUCKET", "diviyata-test-files");
    vi.stubEnv("AWS_REGION", "ap-south-1");
  });

  /** The commands sent to S3, answering each with `answer`. */
  const sent = (answer: object = {}) => vi.spyOn(S3Client.prototype, "send").mockResolvedValue(answer as never);

  it("writes a new object, which S3 refuses if the name is taken", async () => {
    const send = sent();
    const name = randomUUID();
    await writeStoredFile(name, bytes);

    const [command] = send.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toEqual({
      Bucket: "diviyata-test-files",
      Key: `${name.slice(0, 2)}/${name}`,
      Body: bytes,
      IfNoneMatch: "*",
    });
  });

  it("reads an object's bytes", async () => {
    const send = sent({ Body: { transformToByteArray: async () => bytes } });
    const name = randomUUID();
    expect(new Uint8Array(await readStoredFile(name))).toEqual(bytes);

    const [command] = send.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect((command as GetObjectCommand).input).toEqual({
      Bucket: "diviyata-test-files",
      Key: `${name.slice(0, 2)}/${name}`,
    });
  });

  it("removes an object", async () => {
    const send = sent();
    const name = randomUUID();
    await deleteStoredFile(name);

    const [command] = send.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect((command as DeleteObjectCommand).input).toEqual({
      Bucket: "diviyata-test-files",
      Key: `${name.slice(0, 2)}/${name}`,
    });
  });

  it("passes S3's refusal on, and asks nothing for a name it didn't make", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockRejectedValue(new Error("PreconditionFailed"));
    await expect(writeStoredFile(randomUUID(), bytes)).rejects.toThrow("PreconditionFailed");

    send.mockClear();
    await expect(deleteStoredFile("../other-bucket")).rejects.toThrow("Not a stored file name");
    expect(send).not.toHaveBeenCalled();
  });
});
