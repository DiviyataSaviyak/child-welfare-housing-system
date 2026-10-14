import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gatewayAddress, internationalNumber, sendSms, smsSetup } from "./sms";

describe("SMS setup (AUTH-7)", () => {
  it("uses the gateway wherever SMS_URL is set", () => {
    expect(smsSetup({ APP_ENV: "production", SMS_URL: " https://sms.example/send?to={to} " })).toEqual({
      kind: "gateway",
      url: "https://sms.example/send?to={to}",
    });
  });

  it("writes to a file in development and CI, and can't send on a server without a gateway", () => {
    expect(smsSetup({ APP_ENV: "ci", SMS_OUTBOX: "/tmp/out.jsonl" })).toEqual({
      kind: "outbox",
      file: "/tmp/out.jsonl",
    });
    expect(smsSetup({})).toMatchObject({ kind: "outbox" });
    expect(smsSetup({ APP_ENV: "staging" })).toBeNull();
    expect(smsSetup({ APP_ENV: "production", SMS_URL: "" })).toBeNull();
  });
});

describe("the gateway's address", () => {
  it("puts in the number as 94… and the text, encoded", () => {
    expect(internationalNumber("0712345678")).toBe("94712345678");
    expect(
      gatewayAddress("https://sms.example/send?key=k&to={to}&message={text}", "0712345678", "කේතය 123456 & more"),
    ).toBe(`https://sms.example/send?key=k&to=94712345678&message=${encodeURIComponent("කේතය 123456 & more")}`);
  });
});

describe("sending", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds each message to the outbox file", async () => {
    const folder = await mkdtemp(join(tmpdir(), "sms-"));
    const file = join(folder, "nested", "outbox.jsonl");
    try {
      expect(await sendSms("0712345678", "one", { kind: "outbox", file })).toBe(true);
      expect(await sendSms("0712345679", "two", { kind: "outbox", file })).toBe(true);
      const lines = (await readFile(file, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(lines).toMatchObject([
        { to: "0712345678", text: "one" },
        { to: "0712345679", text: "two" },
      ]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("calls the gateway and says whether it took the message", async () => {
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const gateway = { kind: "gateway", url: "https://sms.example/send?to={to}&message={text}" } as const;

    expect(await sendSms("0712345678", "hi", gateway)).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://sms.example/send?to=94712345678&message=hi", expect.anything());

    fetch.mockResolvedValueOnce(new Response("no", { status: 401 }));
    expect(await sendSms("0712345678", "hi", gateway)).toBe(false);
    fetch.mockRejectedValueOnce(new Error("offline"));
    expect(await sendSms("0712345678", "hi", gateway)).toBe(false);
  });

  it("sends nothing where SMS isn't set up", async () => {
    expect(await sendSms("0712345678", "hi", null)).toBe(false);
  });
});
