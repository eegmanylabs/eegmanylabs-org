// The search box whose query lives in the address: fast typing loses nothing, the address is
// written once typing pauses, and a change of the address shows in the box.
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEARCH_COMMIT_DELAY_MS, useSearchText, useUrlState } from "./url-state";

afterEach(() => {
  vi.useRealTimers();
});

describe("useSearchText", () => {
  it("keeps every keystroke and writes the address once typing pauses", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const { result } = renderHook(({ stored }) => useSearchText(stored, commit), { initialProps: { stored: "" } });
    for (const text of ["S", "Sy", "Syn", "Synthetic Person 12"]) {
      act(() => result.current[1](text));
    }
    expect(result.current[0]).toBe("Synthetic Person 12");
    expect(commit).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SEARCH_COMMIT_DELAY_MS);
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("Synthetic Person 12");
  });

  it("clears the search at once when the box is emptied", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const { result } = renderHook(({ stored }) => useSearchText(stored, commit), {
      initialProps: { stored: "harbour" },
    });
    act(() => result.current[1](""));
    expect(commit).toHaveBeenCalledWith("");
  });

  it("shows a query that the address brings, such as after the Back button", () => {
    const { result, rerender } = renderHook(({ stored }) => useSearchText(stored, vi.fn()), {
      initialProps: { stored: "ada" },
    });
    expect(result.current[0]).toBe("ada");
    rerender({ stored: "ben" });
    expect(result.current[0]).toBe("ben");
  });
});

describe("useUrlState", () => {
  it("builds two changes made before the page renders again on each other", () => {
    const parse = (params: URLSearchParams) => ({ a: params.get("a"), b: params.get("b") });
    const serialise = (state: { a: string | null; b: string | null }) => {
      const params = new URLSearchParams();
      if (state.a !== null) params.set("a", state.a);
      if (state.b !== null) params.set("b", state.b);
      return params;
    };
    const { result } = renderHook(() => useUrlState(parse, serialise), {
      wrapper: ({ children }) => <MemoryRouter initialEntries={["/list?a=1&b=2"]}>{children}</MemoryRouter>,
    });
    act(() => {
      result.current[1]({ a: null, b: null });
      result.current[1]({ b: "3" });
    });
    expect(result.current[0]).toEqual({ a: null, b: "3" });
  });
});
