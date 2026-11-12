import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Live } from "@/data";
import { LiveView, SLOW_AFTER_MS } from "./live-view";

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

  it("asks for another try, not a reload, where it offers one, and shows a callable's own message", () => {
    const failed: Live<string> = {
      status: "error",
      error: { code: "failed-precondition", message: "Drive did not answer." },
    };
    const retried = render(
      <LiveView<string>
        live={failed}
        loadingLabel="Loading"
        errorTitle="The folder could not be opened."
        onRetry={() => undefined}
      >
        {(data) => <p>{data}</p>}
      </LiveView>,
    );
    expect(retried.getByRole("alert").textContent).toContain("Try again in a moment.");
    expect(retried.getByRole("alert").textContent).not.toContain("Reload");
    retried.unmount();
    render(
      <LiveView<string> live={failed} loadingLabel="Loading" errorTitle="The folder could not be opened." fromCallable>
        {(data) => <p>{data}</p>}
      </LiveView>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Drive did not answer.");
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

  it("still says what is loading when the custom loading state is only decoration", () => {
    render(
      <LiveView
        live={{ status: "loading" }}
        loadingLabel="Loading your account"
        loading={<span aria-hidden="true" data-testid="skeleton" />}
        errorTitle="Failed"
      >
        {() => null}
      </LiveView>,
    );
    expect(screen.getByTestId("skeleton")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading your account");
  });

  it("offers no way to try again unless the view gives one", () => {
    view({ status: "error", error: { code: "unavailable", message: "detail" } });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers to try again when the view gives a way, and uses it", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <LiveView
        live={{ status: "error", error: { code: "permission-denied", message: "detail" } }}
        loadingLabel="Loading"
        errorTitle="The record could not be loaded."
        onRetry={onRetry}
      >
        {() => null}
      </LiveView>,
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("LiveView while loading takes long", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const SLOW = "This is taking longer than usual. Check your connection.";

  it.each([
    ["the standard loading state", undefined],
    ["a custom loading state", <span key="skeleton" aria-hidden="true" />],
  ])("says so after a while, with %s", (_label, loading) => {
    vi.useFakeTimers();
    render(
      <LiveView live={{ status: "loading" }} loadingLabel="Loading the record" loading={loading} errorTitle="Failed">
        {() => null}
      </LiveView>,
    );
    act(() => vi.advanceTimersByTime(SLOW_AFTER_MS - 1));
    expect(screen.queryByText(SLOW)).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    const statuses = screen.getAllByRole("status").map((status) => status.textContent);
    expect(statuses).toEqual(["Loading the record", SLOW]);
  });

  it("says nothing of the kind once the value has arrived", () => {
    vi.useFakeTimers();
    const loadingView = (
      <LiveView live={{ status: "loading" } as Live<string>} loadingLabel="Loading" errorTitle="Failed">
        {(data) => <p>{data}</p>}
      </LiveView>
    );
    const rendered = render(loadingView);
    rendered.rerender(
      <LiveView
        live={{ status: "ready", data: "A record", fromCache: false, hasPendingWrites: false }}
        loadingLabel="Loading"
        errorTitle="Failed"
      >
        {(data) => <p>{data}</p>}
      </LiveView>,
    );
    act(() => vi.advanceTimersByTime(SLOW_AFTER_MS * 2));
    expect(screen.queryByText(SLOW)).toBeNull();
    expect(screen.getByText("A record")).toBeTruthy();
  });
});
