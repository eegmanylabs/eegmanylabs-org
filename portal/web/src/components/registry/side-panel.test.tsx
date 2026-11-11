// The preview beside a list: on a narrow screen it is a modal dialog whose focus never reaches the
// list it covers. The record is synthetic.
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidePanel } from "./side-panel";

function narrowScreen(narrow: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: !narrow, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

function panel() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <input aria-label="Search members" />
            <SidePanel title="Synthetic Person" fullPage="/members/p-1" onClose={() => undefined}>
              <p>Details</p>
            </SidePanel>
          </>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SidePanel", () => {
  it("keeps focus inside the panel on a narrow screen, from its last control to its first and back", () => {
    narrowScreen(true);
    panel();
    const aside = screen.getByTestId("side-panel");
    expect(aside.getAttribute("role")).toBe("dialog");
    expect(aside.getAttribute("aria-modal")).toBe("true");
    const close = screen.getByRole("button", { name: "Close the preview" });
    const full = screen.getByRole("link", { name: "Open the full page" });
    full.focus();
    fireEvent.keyDown(full, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(full);
    // From the heading, which takes focus when the panel opens, Shift+Tab stays inside too.
    screen.getByRole("heading", { name: "Synthetic Person" }).focus();
    fireEvent.keyDown(aside, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(full);
  });

  it("sits beside the list on a wide screen, where the list stays reachable", () => {
    narrowScreen(false);
    panel();
    expect(screen.getByTestId("side-panel").getAttribute("role")).toBeNull();
  });
});
