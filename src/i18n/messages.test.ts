import { type MessageFormatElement, parse, TYPE } from "@formatjs/icu-messageformat-parser";
import { createTranslator, type IntlError } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import si from "../../messages/si.json";
import ta from "../../messages/ta.json";
import { LOCALES, type Locale } from "./locales";

type Tree = { [key: string]: string | Tree };

const MESSAGES: Record<Locale, Tree> = { si, ta, en };

/** Every message by its dotted key. */
function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") flat.set(path, value);
    else for (const [inner, text] of flatten(value, path)) flat.set(inner, text);
  }
  return flat;
}

/** The arguments a message takes, and which of them choose a plural form. */
function argumentsOf(elements: MessageFormatElement[], found = new Map<string, "plural" | "text">()) {
  for (const element of elements) {
    if (element.type === TYPE.plural) {
      found.set(element.value, "plural");
      for (const option of Object.values(element.options)) argumentsOf(option.value, found);
    } else if (element.type === TYPE.select) {
      found.set(element.value, "text");
      for (const option of Object.values(element.options)) argumentsOf(option.value, found);
    } else if (element.type === TYPE.argument || element.type === TYPE.number || element.type === TYPE.date) {
      found.set(element.value, element.type === TYPE.number ? "plural" : "text");
    } else if (element.type === TYPE.tag) {
      argumentsOf(element.children, found);
    }
  }
  return found;
}

const flat = Object.fromEntries(LOCALES.map((locale) => [locale, flatten(MESSAGES[locale])])) as Record<
  Locale,
  Map<string, string>
>;
const keys = [...flat.si.keys()];

// The language picker names each language in its own script, on every screen (UI-9).
const PICKER = new Set(["language.names.si", "language.names.ta", "language.names.en"]);

describe("the screen languages' message files (UI-1, UI-9)", () => {
  it.each(["ta", "en"] as const)("%s.json has exactly the keys of si.json", (locale) => {
    expect([...flat[locale].keys()].sort()).toEqual([...keys].sort());
  });

  it.each(["ta", "en"] as const)("%s.json takes the same arguments as si.json in every message", (locale) => {
    for (const key of keys) {
      const source = [...argumentsOf(parse(flat.si.get(key)!)).keys()].sort();
      const translated = [...argumentsOf(parse(flat[locale].get(key) ?? "")).keys()].sort();
      expect(translated, key).toEqual(source);
    }
  });

  it.each(LOCALES)("every %s message formats without an error", (locale) => {
    const errors: string[] = [];
    const t = createTranslator({
      locale,
      messages: MESSAGES[locale],
      onError: (error: IntlError) => errors.push(error.message),
    }) as unknown as (key: string, values: Record<string, string | number>) => string;
    for (const key of keys) {
      const values = Object.fromEntries(
        [...argumentsOf(parse(flat.si.get(key)!))].map(([name, kind]) => [name, kind === "plural" ? 2 : "x"]),
      );
      t(key, values);
    }
    expect(errors).toEqual([]);
  });

  it("writes each language in its own letters, apart from the language picker", () => {
    const sinhala = /\p{Script=Sinhala}/u;
    const tamil = /\p{Script=Tamil}/u;
    for (const key of keys) {
      if (PICKER.has(key)) continue;
      expect(flat.si.get(key), `si ${key}`).not.toMatch(tamil);
      expect(flat.ta.get(key), `ta ${key}`).not.toMatch(sinhala);
      expect(flat.en.get(key), `en ${key}`).not.toMatch(sinhala);
      expect(flat.en.get(key), `en ${key}`).not.toMatch(tamil);
    }
  });

  it("keeps Latin letters off the Sinhala and Tamil screens' main labels (AC-20)", () => {
    // Help texts may name file types such as PDF; the labels a screen is built from may not.
    for (const key of [
      "app.name",
      "app.ministry",
      "nav.dsHome",
      "nav.ministryDashboard",
      "nav.adminUsers",
      "login.title",
    ]) {
      for (const locale of ["si", "ta"] as const)
        expect(flat[locale].get(key), `${locale} ${key}`).not.toMatch(/[A-Za-z]/);
    }
  });

  it("never calls the Ministry Head Office, in any language (UI-10, AC-58)", () => {
    const headOffice = { si: /ප්‍රධාන\s*කාර්යාල/, ta: /தலைமை\s*அலுவலக/, en: /head\s*office/i };
    for (const locale of LOCALES)
      for (const [key, text] of flat[locale]) expect(text, `${locale} ${key}`).not.toMatch(headOffice[locale]);
  });
});
