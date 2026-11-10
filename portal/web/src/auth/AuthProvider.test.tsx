// The provider is tested without Firebase: "@/data" is replaced by stand-ins the test controls.
// Addresses are synthetic and use the example.org domain.
import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/data";
import type { AuthContextValue } from "./AuthProvider";

const data = vi.hoisted(() => {
  class SignInError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  }
  return {
    SignInError,
    emit: (() => {}) as (user: SessionUser | null) => void,
    observeSession: vi.fn(),
    startSession: vi.fn(),
    completeSignInLink: vi.fn(),
    requestSignInLink: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    isSignInLink: vi.fn(() => false),
    useAccessRecord: vi.fn(() => ({ status: "idle" })),
  };
});
vi.mock("@/data", () => data);

const member: SessionUser = { uid: "uid-member", email: "member@example.org", displayName: null };
const LINK = "http://localhost/?apiKey=fake&oobCode=code-1&mode=signIn";
const PENDING_KEY = "portal.signIn.pending";

let context: AuthContextValue;

function Probe() {
  context = useAuthFromModule();
  const location = useLocation();
  return (
    <p data-testid="state">
      {[
        context.session.status,
        context.link.status,
        context.registration,
        `${location.pathname}${location.search}`,
      ].join(" | ")}
    </p>
  );
}

let useAuthFromModule: () => AuthContextValue;

async function renderProvider(signInLink: string | null = null, at = "/") {
  // A fresh copy of the module for each test: it remembers which accounts it has registered.
  // The toast provider comes from the same fresh module graph, so both share one context.
  vi.resetModules();
  const module = await import("./AuthProvider");
  const { ToastProvider } = await import("@/components/ui/toast");
  useAuthFromModule = module.useAuth;
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <ToastProvider>
            <module.AuthProvider signInLink={signInLink}>
              <Probe />
            </module.AuthProvider>
          </ToastProvider>
        ),
      },
    ],
    { initialEntries: [at] },
  );
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

const state = () => screen.getByTestId("state").textContent;

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  data.observeSession.mockImplementation((listener: (user: SessionUser | null) => void) => {
    data.emit = listener;
    return () => {};
  });
  data.startSession.mockResolvedValue({ member: false, personId: null });
  data.completeSignInLink.mockResolvedValue(member);
  data.requestSignInLink.mockResolvedValue(undefined);
  data.signOut.mockResolvedValue(undefined);
});

describe("AuthProvider", () => {
  it("starts in the loading state and follows the session", async () => {
    await renderProvider();
    expect(state()).toBe("loading | none | idle | /");
    act(() => data.emit(null));
    expect(state()).toBe("signed-out | none | idle | /");
  });

  it("registers the account with the server once after a sign-in, even though effects run twice", async () => {
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toBe("signed-in | none | done | /"));
    expect(data.startSession).toHaveBeenCalledTimes(1);
  });

  it("registers again after the account has signed out and in again", async () => {
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("done"));

    await act(() => context.signOut());
    act(() => data.emit(null));
    expect(data.signOut).toHaveBeenCalledOnce();
    expect(state()).toBe("signed-out | none | idle | /login");

    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("done"));
    expect(data.startSession).toHaveBeenCalledTimes(2);
  });

  it("reports a failed registration and tries again on request", async () => {
    data.startSession.mockRejectedValueOnce(new Error("unavailable"));
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toBe("signed-in | none | failed | /"));

    act(() => context.retryRegistration());
    await waitFor(() => expect(state()).toBe("signed-in | none | done | /"));
    expect(data.startSession).toHaveBeenCalledTimes(2);
  });

  it("asks for a link, remembers the address and the destination, and gives Firebase an address without a code", async () => {
    await renderProvider();
    act(() => data.emit(null));
    await act(() => context.sendLink("member@example.org", "/labs/lab-1"));

    expect(data.requestSignInLink).toHaveBeenCalledWith("member@example.org", "http://localhost:3000/");
    expect(JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "null")).toEqual({
      email: "member@example.org",
      next: "/labs/lab-1",
    });
  });

  it("completes a sign-in link at start with the remembered address and goes where the visitor was heading", async () => {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify({ email: "member@example.org", next: "/labs/lab-1" }));
    let finish: (user: SessionUser) => void = () => {};
    data.completeSignInLink.mockReturnValueOnce(new Promise<SessionUser>((resolve) => (finish = resolve)));
    await renderProvider(LINK);
    act(() => data.emit(null));
    // Signed out as far as Firebase knows, but a guard must wait: the link is still being completed.
    expect(state()).toBe("signed-out | completing | idle | /");

    act(() => finish(member));
    await waitFor(() => expect(state()).toContain("/labs/lab-1"));
    expect(data.completeSignInLink).toHaveBeenCalledTimes(1);
    expect(data.completeSignInLink).toHaveBeenCalledWith("member@example.org", LINK);
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(state()).toContain("| none |");
  });

  it("asks for the address when the link was opened in a browser that does not remember it", async () => {
    await renderProvider(LINK);
    act(() => data.emit(null));
    expect(state()).toBe("signed-out | needs-email | idle | /");
    expect(data.completeSignInLink).not.toHaveBeenCalled();

    data.completeSignInLink.mockRejectedValueOnce(new data.SignInError("email-mismatch"));
    await act(async () => {
      await expect(context.confirmLinkEmail("someone.else@example.org")).rejects.toBeInstanceOf(data.SignInError);
    });
    // The wrong address can be corrected: the page keeps asking.
    expect(state()).toContain("needs-email");

    await act(() => context.confirmLinkEmail("member@example.org"));
    expect(data.completeSignInLink).toHaveBeenLastCalledWith("member@example.org", LINK);
    expect(state()).toContain("| none |");
  });

  it("gives up on a link that has expired or been used, and forgets the remembered address", async () => {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify({ email: "member@example.org", next: null }));
    data.completeSignInLink.mockRejectedValueOnce(new data.SignInError("link-invalid"));
    await renderProvider(LINK);
    act(() => data.emit(null));
    await waitFor(() => expect(state()).toBe("signed-out | failed | idle | /"));
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("does not follow a destination outside the portal", async () => {
    window.localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ email: "member@example.org", next: "https://example.org/phish" }),
    );
    await renderProvider(LINK, "/somewhere");
    await waitFor(() => expect(data.completeSignInLink).toHaveBeenCalled());
    await waitFor(() => expect(state()).toMatch(/\| \/$/));
  });
});
