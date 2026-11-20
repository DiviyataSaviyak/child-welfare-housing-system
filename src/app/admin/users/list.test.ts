import { describe, expect, it } from "vitest";
import { readUsersAddress, sortChange, usersHref, withoutFilter } from "./list";

const read = (query: string) => {
  const params = new URLSearchParams(query);
  return readUsersAddress((key) => params.get(key) ?? "");
};

describe("the users screen's address (ADM-12)", () => {
  it("reads the filters, the sort and the page, leaving out what isn't one", () => {
    expect(
      read("officeType=DS&provinceId=2&districtId=5&dsOfficeId=40&status=neverSignedIn&sort=name&page=3").filter,
    ).toMatchObject({
      officeType: "DS",
      provinceId: 2,
      districtId: 5,
      dsOfficeId: 40,
      status: "neverSignedIn",
      sort: "name",
      reversed: false,
      page: 3,
    });
    expect(read("officeType=HEAD&provinceId=x&status=gone&sort=role&order=reversed&page=-1").filter).toEqual({
      q: "",
      officeType: undefined,
      provinceId: undefined,
      districtId: undefined,
      dsOfficeId: undefined,
      status: undefined,
      sort: undefined,
      reversed: false,
      page: undefined,
    });
  });

  it("takes a DS office only with its district", () => {
    expect(read("dsOfficeId=40").filter.dsOfficeId).toBeUndefined();
  });

  it("goes back to the first page on any change but the page", () => {
    const { address } = read("q=perera&status=active&page=3");
    expect(usersHref(address, { status: "disabled" })).toBe("/admin/users?q=perera&status=disabled");
    expect(usersHref(address, { page: "4" })).toBe("/admin/users?q=perera&status=active&page=4");
    expect(usersHref(address, { page: "1" })).toBe("/admin/users?q=perera&status=active");
  });

  it("removes the places within a place removed (AC-72)", () => {
    const { address } = read("provinceId=2&districtId=5&dsOfficeId=40&status=active");
    expect(usersHref(address, withoutFilter("districtId"))).toBe("/admin/users?provinceId=2&status=active");
    expect(usersHref(address, withoutFilter("provinceId"))).toBe("/admin/users?status=active");
    expect(usersHref(address, withoutFilter("dsOfficeId"))).toBe(
      "/admin/users?provinceId=2&districtId=5&status=active",
    );
  });

  it("sorts by a heading, and turns it round on a second click", () => {
    const start = read("").address;
    expect(sortChange(start, "lastSignIn")).toEqual({ sort: "lastSignIn", order: "" });
    const sorted = read("sort=lastSignIn").address;
    expect(sortChange(sorted, "lastSignIn")).toEqual({ sort: "lastSignIn", order: "reversed" });
    expect(sortChange(read("sort=lastSignIn&order=reversed").address, "lastSignIn")).toEqual({
      sort: "lastSignIn",
      order: "",
    });
    expect(sortChange(sorted, "name")).toEqual({ sort: "name", order: "" });
  });
});
