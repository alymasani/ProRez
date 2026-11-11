import { describe, expect, it } from "vitest";
import { initialSearchSync, markPushed, reconcileWithUrl } from "./search-sync";

describe("search input ↔ URL sync", () => {
  it("ignores the URL echoing back our own push", () => {
    let state = initialSearchSync("");
    state = { ...state, input: "backend" };
    state = markPushed(state, "backend");
    const result = reconcileWithUrl(state, "backend");
    expect(result.external).toBe(false);
    expect(result.state.input).toBe("backend");
  });

  it("does not clobber typing that is ahead of the last push", () => {
    let state = markPushed(initialSearchSync(""), "back");
    state = { ...state, input: "backend" }; // user kept typing; debounce pending
    const result = reconcileWithUrl(state, "back");
    expect(result.external).toBe(false);
    expect(result.state.input).toBe("backend");
  });

  it("adopts the URL query on browser back (regression)", () => {
    // Start empty, search for "toronto", then press Back.
    let state = initialSearchSync("");
    state = markPushed({ ...state, input: "toronto" }, "toronto");
    state = reconcileWithUrl(state, "toronto").state;

    const back = reconcileWithUrl(state, "");
    expect(back.external).toBe(true);
    expect(back.state).toEqual({ input: "", lastPushed: "" });

    const forward = reconcileWithUrl(back.state, "toronto");
    expect(forward.external).toBe(true);
    expect(forward.state.input).toBe("toronto");
  });

  it("treats an external change as external even while a newer value is being typed", () => {
    const state = { input: "mobile dev", lastPushed: "mobile" };
    const result = reconcileWithUrl(state, "data");
    expect(result.external).toBe(true);
    expect(result.state.input).toBe("data");
  });
});
