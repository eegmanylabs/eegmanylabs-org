import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Live } from "@/data";
import { LiveView } from "./live-view";

// The data layer starts Firebase when it is imported. This component only needs its types.
vi.mock("@/data", () => ({}));

function view(live: Live<string>) {
  return render(
    <LiveView live={live} loadingLabel="Loading the record" errorTitle="The record could not be loaded.">
      {(data) => <p>{data}</p>}
    </LiveView>,
  );
}

describe("LiveView", () => {
  it("shows the loading state while there is no value", () => {
    view({ status: "loading" });
    expect(screen.getByRole("status").textContent).toBe("Loading the record");
  });

  it("shows the value when there is one", () => {
    view({ status: "ready", data: "A record", fromCache: false, hasPendingWrites: false });
    expect(screen.getByText("A record")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["permission-denied", "Your account is not allowed to see this."],
    ["unavailable", "The portal could not reach its server. Check your connection."],
    ["data/invalid-shape", /does not understand/],
    ["something-new", "Reload the page to try again."],
  ])("explains a failure of the kind %s without showing internal detail", (code, description) => {
    view({ status: "error", error: { code, message: "internal detail: users/uid-123" } });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The record could not be loaded.");
    expect(alert.textContent).toMatch(description);
    expect(alert.textContent).not.toContain("internal detail");
  });

  it("renders nothing when there is nothing to watch", () => {
    const { container } = view({ status: "idle" });
    expect(container.textContent).toBe("");
  });

  it("can show a custom loading state", () => {
    render(
      <LiveView live={{ status: "loading" }} loadingLabel="Loading" loading={<p>Skeleton</p>} errorTitle="Failed">
        {() => null}
      </LiveView>,
    );
    expect(screen.getByText("Skeleton")).toBeTruthy();
  });
});
