import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  sendMail: vi.fn(async () => ({ messageId: "1" })),
  close: vi.fn(),
  options: [] as unknown[],
}));
vi.mock("nodemailer", () => ({
  createTransport: (options: unknown) => {
    transport.options.push(options);
    return transport;
  },
}));

const { mailSetup, sendMail } = await import("./mail");

describe("mail setup (AUTH-7)", () => {
  it("uses the mail server wherever SMTP_HOST is set, sending from SMTP_USER unless MAIL_FROM says otherwise", () => {
    const env = { APP_ENV: "production", SMTP_HOST: " smtp.gmail.com ", SMTP_USER: "diviyata@gmail.com" };
    expect(mailSetup({ ...env, SMTP_PASSWORD: "app-password" })).toEqual({
      kind: "smtp",
      host: "smtp.gmail.com",
      port: 465,
      user: "diviyata@gmail.com",
      password: "app-password",
      from: "diviyata@gmail.com",
    });
    expect(mailSetup({ ...env, SMTP_PORT: "587", MAIL_FROM: "no-reply@example.lk" })).toMatchObject({
      port: 587,
      from: "no-reply@example.lk",
    });
  });

  it("writes to a file in development and CI, and can't send on a server without a mail server", () => {
    expect(mailSetup({ APP_ENV: "ci", MAIL_OUTBOX: "/tmp/out.jsonl" })).toEqual({
      kind: "outbox",
      file: "/tmp/out.jsonl",
    });
    expect(mailSetup({})).toMatchObject({ kind: "outbox" });
    expect(mailSetup({ APP_ENV: "staging" })).toBeNull();
    expect(mailSetup({ APP_ENV: "production", SMTP_HOST: "" })).toBeNull();
  });
});

describe("sending", () => {
  afterEach(() => {
    transport.options.length = 0;
    vi.clearAllMocks();
  });

  it("adds each email to the outbox file", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mail-"));
    const file = join(folder, "nested", "outbox.jsonl");
    try {
      expect(await sendMail("one@example.com", { subject: "s1", text: "one" }, { kind: "outbox", file })).toBe(true);
      expect(await sendMail("two@example.com", { subject: "s2", text: "two" }, { kind: "outbox", file })).toBe(true);
      const lines = (await readFile(file, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(lines).toMatchObject([
        { to: "one@example.com", subject: "s1", text: "one" },
        { to: "two@example.com", subject: "s2", text: "two" },
      ]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  const smtp = (port: number) =>
    ({ kind: "smtp", host: "smtp.example.com", port, user: "u", password: "p", from: "from@example.com" }) as const;

  it("sends through the mail server over TLS and says whether it took the email", async () => {
    expect(await sendMail("officer@example.com", { subject: "s", text: "t" }, smtp(465))).toBe(true);
    expect(transport.options[0]).toMatchObject({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "u", pass: "p" },
    });
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: "from@example.com",
      to: "officer@example.com",
      subject: "s",
      text: "t",
    });
    expect(transport.close).toHaveBeenCalled();

    await sendMail("officer@example.com", { subject: "s", text: "t" }, smtp(587));
    expect(transport.options[1]).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });

  it("answers false, logging only the error's code, when the mail server refuses", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    transport.sendMail.mockRejectedValueOnce(
      Object.assign(new Error("Invalid login for officer@example.com"), { code: "EAUTH" }),
    );

    expect(await sendMail("officer@example.com", { subject: "s", text: "t" }, smtp(465))).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('"code":"EAUTH"');
    expect(error.mock.calls[0][0]).not.toContain("officer@example.com");
    expect(transport.close).toHaveBeenCalled();
    error.mockRestore();
  });

  it("sends nothing where email isn't set up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await sendMail("officer@example.com", { subject: "s", text: "t" }, null)).toBe(false);
    warn.mockRestore();
  });
});
