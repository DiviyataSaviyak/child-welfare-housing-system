import { describe, expect, it } from "vitest";
import { homeFor, isRole, safeReturnPath } from "./roles";

describe("roles", () => {
  it("recognises only the five roles", () => {
    expect(isRole("DS_OFFICER")).toBe(true);
    expect(isRole("DISTRICT_OFFICER")).toBe(true);
    expect(isRole("HO_OFFICER")).toBe(true);
    expect(isRole("VIEWER")).toBe(true);
    expect(isRole("ADMIN")).toBe(true);
    expect(isRole("user")).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it("sends each role to its own home page", () => {
    expect(homeFor("DS_OFFICER")).toBe("/ds");
    expect(homeFor("HO_OFFICER")).toBe("/ho");
    expect(homeFor("ADMIN")).toBe("/admin/users");
    expect(homeFor("VIEWER")).toBe("/oversight");
    expect(homeFor("DISTRICT_OFFICER")).toBe("/oversight");
  });
});

describe("returning to the page asked for after sign-in (ERR-4)", () => {
  it("allows a page in the role's own area", () => {
    expect(safeReturnPath("/ds/cases/new", "DS_OFFICER")).toBe("/ds/cases/new");
    expect(safeReturnPath("/ds", "DS_OFFICER")).toBe("/ds");
    expect(safeReturnPath("/ho/check?tab=release", "HO_OFFICER")).toBe("/ho/check?tab=release");
  });

  it("refuses another role's pages", () => {
    expect(safeReturnPath("/ho", "DS_OFFICER")).toBeNull();
    expect(safeReturnPath("/admin/users", "HO_OFFICER")).toBeNull();
    expect(safeReturnPath("/dsx", "DS_OFFICER")).toBeNull();
    expect(safeReturnPath("/ho", "VIEWER")).toBeNull();
    expect(safeReturnPath("/oversight/cases", "DS_OFFICER")).toBeNull();
  });

  it("refuses other sites and odd input", () => {
    expect(safeReturnPath("https://evil.example/ds", "DS_OFFICER")).toBeNull();
    expect(safeReturnPath("//evil.example/ds", "DS_OFFICER")).toBeNull();
    expect(safeReturnPath("/\\evil.example", "DS_OFFICER")).toBeNull();
    expect(safeReturnPath(undefined, "DS_OFFICER")).toBeNull();
    expect(safeReturnPath(42, "DS_OFFICER")).toBeNull();
  });
});
