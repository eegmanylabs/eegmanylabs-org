// The provider is tested without Firebase: "@/data" is replaced by stand-ins the test controls.
// Addresses are synthetic and use the example.org domain.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
  class SecondFactorChallengeError extends SignInError {
    constructor(readonly challenge: { factors: unknown[]; answer: (uid: string, code: string) => Promise<unknown> }) {
      super("second-factor");
    }
  }
  class CallableError extends Error {
    constructor(
      readonly code: string,
      message = "A general message.",
    ) {
      super(message);
    }
  }
  return {
    SignInError,
    SecondFactorChallengeError,
    CallableError,
    callFunction: vi.fn(),
    emit: (() => {}) as (user: SessionUser | null) => void,
    observeSession: vi.fn(),
    startSession: vi.fn(),
    completeSignInLink: vi.fn(),
    requestSignInLink: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    discardLocalData: vi.fn(),
    isSignInLink: vi.fn(() => false),
    useAccessRecord: vi.fn(() => ({ status: "idle" })),
  };
});
vi.mock("@/data", () => data);

// Loading the page afresh is replaced by a record of the request: jsdom cannot navigate.
const restart = vi.hoisted(() => ({ restartApplication: vi.fn() }));
vi.mock("@/app/restart", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/restart")>()),
  restartApplication: restart.restartApplication,
}));

const member: SessionUser = {
  uid: "uid-member",
  email: "member@example.org",
  displayName: null,
  signedInAt: 1_700_000_000,
  secondFactor: false,
};
const someoneElse: SessionUser = {
  uid: "uid-other",
  email: "other.member@example.org",
  displayName: null,
  signedInAt: 1_700_000_000,
  secondFactor: false,
};
const LINK = "http://localhost/?apiKey=fake&oobCode=code-1&mode=signIn";
const PENDING_KEY = "portal.signIn.pending";
const NOTICE_KEY = "portal.notice";

let context: AuthContextValue;

function Probe() {
  context = useAuthFromModule();
  const location = useLocation();
  return (
    <p data-testid="state">
      {[
        context.session.status,
        context.link.status,
        context.registration.status,
        `${location.pathname}${location.search}`,
      ].join(" | ")}
    </p>
  );
}

let useAuthFromModule: () => AuthContextValue;

async function renderProvider(signInLink: string | null = null, at = "/") {
  // A fresh copy of the module for each test, as a page that has just loaded has: the module
  // remembers which accounts it has registered. The toast provider comes from the same fresh
  // module graph, so both share one context.
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

const rememberRequest = (next: string | null, requestedAt = Date.now()) =>
  window.localStorage.setItem(PENDING_KEY, JSON.stringify({ email: "member@example.org", next, requestedAt }));

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
  data.observeSession.mockImplementation((listener: (user: SessionUser | null) => void) => {
    data.emit = listener;
    return () => {};
  });
  data.startSession.mockResolvedValue({ member: false, personId: null });
  data.completeSignInLink.mockResolvedValue(member);
  data.requestSignInLink.mockResolvedValue(undefined);
  data.signOut.mockResolvedValue(undefined);
  data.discardLocalData.mockResolvedValue(undefined);
  data.useAccessRecord.mockReturnValue({ status: "idle" });
  data.callFunction.mockResolvedValue({ sessionsValidAfter: "2026-11-10T12:00:00.000Z" });
});

describe("AuthProvider", () => {
  it("starts in the loading state and follows the session", async () => {
    await renderProvider();
    expect(state()).toBe("loading | none | idle | /");
    act(() => data.emit(null));
    expect(state()).toBe("signed-out | none | idle | /");
  });

  it("tells the server once that the portal has started with the account, even though effects run twice", async () => {
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toBe("signed-in | none | done | /"));
    expect(data.startSession).toHaveBeenCalledTimes(1);
  });

  it("asks the server again on request even after a call that succeeded", async () => {
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toBe("signed-in | none | done | /"));
    act(() => context.retryRegistration());
    await waitFor(() => expect(data.startSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(state()).toBe("signed-in | none | done | /"));
  });

  it("reports a failed registration with the message of the failure, and tries again on request", async () => {
    data.startSession.mockRejectedValueOnce(
      new data.CallableError("unavailable", "The portal could not reach its server."),
    );
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toBe("signed-in | none | failed | /"));
    expect(context.registration).toEqual({
      status: "failed",
      code: "unavailable",
      message: "The portal could not reach its server.",
    });

    act(() => context.retryRegistration());
    await waitFor(() => expect(state()).toBe("signed-in | none | done | /"));
    expect(data.startSession).toHaveBeenCalledTimes(2);
  });

  it("describes a failure it does not recognise as an internal one, without its detail", async () => {
    data.startSession.mockRejectedValueOnce(new Error("stack detail users/uid-member"));
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("failed"));
    expect(context.registration).toMatchObject({ status: "failed", code: "internal" });
    expect(JSON.stringify(context.registration)).not.toContain("uid-member");
  });
});

describe("AuthProvider when the account goes away", () => {
  it("signs out, discards what the browser holds of the account and starts afresh at the sign-in page", async () => {
    rememberRequest("/labs/lab-1");
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("done"));

    await act(() => context.signOut());
    expect(data.signOut).toHaveBeenCalledOnce();
    // Nothing is discarded before Firebase reports that the account has gone.
    expect(data.discardLocalData).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBe("signed-out");

    await act(async () => data.emit(null));
    expect(data.discardLocalData).toHaveBeenCalledOnce();
    expect(restart.restartApplication).toHaveBeenCalledExactlyOnceWith("/login");
    // The page shows nothing of the account while it is being replaced.
    expect(state()).toBe("loading | none | idle | /");
  });

  it("does the same when the account signs out in another tab", async () => {
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("done"));

    await act(async () => data.emit(null));

    expect(data.signOut).not.toHaveBeenCalled();
    expect(data.discardLocalData).toHaveBeenCalledOnce();
    expect(restart.restartApplication).toHaveBeenCalledExactlyOnceWith("/login");
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();
  });

  it("starts afresh where it is when another account takes the place of the one it was showing", async () => {
    await renderProvider(null, "/labs/lab-1");
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("done"));

    await act(async () => data.emit(someoneElse));

    expect(data.discardLocalData).toHaveBeenCalledOnce();
    expect(restart.restartApplication).toHaveBeenCalledExactlyOnceWith(null);
    expect(state()).toBe("loading | none | idle | /labs/lab-1");
    // The other account is not registered by a page that is on its way out.
    expect(data.startSession).toHaveBeenCalledTimes(1);
  });

  it("restarts even when the local data cannot be discarded", async () => {
    data.discardLocalData.mockRejectedValueOnce(new Error("another tab holds the database"));
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("done"));
    await act(async () => data.emit(null));
    expect(restart.restartApplication).toHaveBeenCalledExactlyOnceWith("/login");
  });

  it("ignores what the session does while the page is being replaced", async () => {
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("done"));
    await act(async () => data.emit(null));

    await act(async () => data.emit(member));
    await act(async () => data.emit(null));

    expect(state()).toBe("loading | none | idle | /");
    expect(data.discardLocalData).toHaveBeenCalledOnce();
    expect(restart.restartApplication).toHaveBeenCalledOnce();
  });

  it("does not restart when a signed-out page sees an account sign in", async () => {
    await renderProvider();
    act(() => data.emit(null));
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toBe("signed-in | none | done | /"));
    expect(data.discardLocalData).not.toHaveBeenCalled();
    expect(restart.restartApplication).not.toHaveBeenCalled();
  });

  it("keeps the confirmation off the next page when signing out fails", async () => {
    data.signOut.mockRejectedValueOnce(new Error("offline"));
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("done"));
    await act(async () => {
      await expect(context.signOut()).rejects.toThrow("offline");
    });
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();
    expect(restart.restartApplication).not.toHaveBeenCalled();
  });

  it("registers the account again after the restart, when it signs in on the fresh page", async () => {
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("done"));
    await act(() => context.signOut());
    await act(async () => data.emit(null));
    expect(restart.restartApplication).toHaveBeenCalledOnce();

    // The restart: the old page is gone and the application loads again.
    cleanup();
    await renderProvider(null, "/login");
    act(() => data.emit(null));
    // The fresh page confirms the sign-out once, and the note is used up.
    expect(await screen.findByText("You have signed out.", { selector: "div" })).toBeTruthy();
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();

    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("done"));
    expect(data.startSession).toHaveBeenCalledTimes(2);
  });
});

describe("AuthProvider when the account is stopped while the page is open", () => {
  const SIGNED_IN_AT = 1_700_000_000;
  const instant = (seconds: number) => ({ toMillis: () => seconds * 1000 });
  const accessRecord = (fields: { suspended?: boolean; sessionsValidAfter?: number | null }, fromCache = false) => ({
    status: "ready",
    fromCache,
    hasPendingWrites: false,
    data: {
      member: false,
      personId: null,
      capabilities: {},
      suspended: fields.suspended ?? false,
      sessionsValidAfter: fields.sessionsValidAfter == null ? null : instant(fields.sessionsValidAfter),
    },
  });
  const refusedRead = { status: "error", error: { code: "permission-denied", message: "Missing permissions." } };

  /** Signs in with a working account, then lets the access document take a new state. */
  async function signedInThen(access: unknown, user: SessionUser = member) {
    data.useAccessRecord.mockReturnValue({ status: "loading" } as never);
    await renderProvider();
    await act(async () => data.emit(user));
    await waitFor(() => expect(state()).toBe("signed-in | none | done | /"));
    expect(data.startSession).toHaveBeenCalledTimes(1);
    data.useAccessRecord.mockReturnValue(access as never);
    // Any new render picks the new state up. This call changes nothing by itself: there is no link.
    act(() => context.abandonLink());
  }

  it.each([
    ["the server refuses the account its own access document", refusedRead],
    ["the access document from the server says that the account is suspended", accessRecord({ suspended: true })],
    [
      "the access document from the server says that the session began before the sessions were ended",
      accessRecord({ sessionsValidAfter: SIGNED_IN_AT + 1 }),
    ],
  ])("asks the server again, to learn why, when %s", async (_label, access) => {
    data.startSession.mockResolvedValueOnce({ member: false, personId: null });
    data.startSession.mockRejectedValueOnce(
      new data.CallableError("permission-denied", "This account has been suspended."),
    );
    await signedInThen(access);

    await waitFor(() => expect(state()).toBe("signed-in | none | failed | /"));
    expect(data.startSession).toHaveBeenCalledTimes(2);
    expect(context.registration).toEqual({
      status: "failed",
      code: "permission-denied",
      message: "This account has been suspended.",
    });
    // The account stays signed in and the page stays: it shows the refusal.
    expect(restart.restartApplication).not.toHaveBeenCalled();
    expect(data.signOut).not.toHaveBeenCalled();
  });

  it.each([
    ["an account in good standing", accessRecord({})],
    ["a session that began when the sessions were ended, or later", accessRecord({ sessionsValidAfter: SIGNED_IN_AT })],
    ["a suspension that is only a copy from the local cache", accessRecord({ suspended: true }, true)],
    [
      "ended sessions that are only a copy from the local cache",
      accessRecord({ sessionsValidAfter: SIGNED_IN_AT + 1 }, true),
    ],
    ["an account without an access document", { ...accessRecord({}), data: null }],
    ["an access document that could not be reached", { status: "error", error: { code: "unavailable", message: "" } }],
  ])("leaves the page alone for %s", async (_label, access) => {
    await signedInThen(access);
    await act(async () => {});
    expect(state()).toBe("signed-in | none | done | /");
    expect(data.startSession).toHaveBeenCalledTimes(1);
    expect(data.discardLocalData).not.toHaveBeenCalled();
    expect(restart.restartApplication).not.toHaveBeenCalled();
    expect(data.signOut).not.toHaveBeenCalled();
  });

  it("leaves ended sessions to the server when the browser does not know when this one began", async () => {
    await signedInThen(accessRecord({ sessionsValidAfter: SIGNED_IN_AT + 1 }), { ...member, signedInAt: null });
    await act(async () => {});
    expect(data.startSession).toHaveBeenCalledTimes(1);
  });
});

describe("AuthProvider when the server refuses the account a session", () => {
  it.each(["permission-denied", "unauthenticated"])(
    "discards what the browser holds of the portal's data after a refusal with %s, and stays on the page",
    async (code) => {
      data.startSession.mockRejectedValueOnce(new data.CallableError(code, "The reason, written for the person."));
      await renderProvider();
      await act(async () => data.emit(member));
      await waitFor(() => expect(state()).toBe("signed-in | none | failed | /"));
      expect(data.discardLocalData).toHaveBeenCalledOnce();
      expect(restart.restartApplication).not.toHaveBeenCalled();
      expect(data.signOut).not.toHaveBeenCalled();
    },
  );

  it.each(["unavailable", "internal", "failed-precondition"])(
    "keeps the local data after a failure with %s, which is no refusal of the account",
    async (code) => {
      data.startSession.mockRejectedValueOnce(new data.CallableError(code));
      await renderProvider();
      await act(async () => data.emit(member));
      await waitFor(() => expect(state()).toBe("signed-in | none | failed | /"));
      expect(data.discardLocalData).not.toHaveBeenCalled();
    },
  );
});

describe("AuthProvider and sign-in links", () => {
  it("asks for a link, remembers the address and the destination, and gives Firebase the start address without a code", async () => {
    await renderProvider();
    act(() => data.emit(null));
    await act(() => context.sendLink("member@example.org", "/labs/lab-1"));

    expect(data.requestSignInLink).toHaveBeenCalledWith("member@example.org", "http://localhost:3000/");
    expect(JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "null")).toMatchObject({
      email: "member@example.org",
      next: "/labs/lab-1",
    });
  });

  it("remembers nothing when no link was sent", async () => {
    data.requestSignInLink.mockRejectedValueOnce(new data.SignInError("service-unavailable"));
    await renderProvider();
    act(() => data.emit(null));
    await act(async () => {
      await expect(context.sendLink("member@example.org", null)).rejects.toBeInstanceOf(data.SignInError);
    });
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("forgets the remembered address on request", async () => {
    await renderProvider();
    act(() => data.emit(null));
    await act(() => context.sendLink("member@example.org", null));
    act(() => context.forgetLinkRequest());
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("completes a sign-in link at start with the remembered address and goes where the visitor was heading", async () => {
    rememberRequest("/labs/lab-1");
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

  it("asks for the address when the remembered request is older than a link lasts", async () => {
    rememberRequest("/labs/lab-1", Date.now() - 7 * 60 * 60 * 1000);
    await renderProvider(LINK);
    act(() => data.emit(null));
    expect(state()).toBe("signed-out | needs-email | idle | /");
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("lets the visitor give up on the link and ask for a new one", async () => {
    await renderProvider(LINK);
    act(() => data.emit(null));
    expect(state()).toContain("needs-email");
    act(() => context.abandonLink());
    expect(state()).toBe("signed-out | none | idle | /");
  });

  it.each(["link-invalid", "account-disabled"])(
    "gives up on a link that failed with %s, and forgets the remembered address",
    async (reason) => {
      rememberRequest(null);
      data.completeSignInLink.mockRejectedValueOnce(new data.SignInError(reason));
      await renderProvider(LINK);
      act(() => data.emit(null));
      await waitFor(() => expect(state()).toBe("signed-out | failed | idle | /"));
      expect(context.link).toEqual({ status: "failed", reason, retryable: false });
      expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();

      act(() => context.retryLink());
      expect(data.completeSignInLink).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["network", "service-unavailable", "unknown"])(
    "keeps the link and the remembered address after a failure with %s, and completes the link on a new try",
    async (reason) => {
      rememberRequest("/labs/lab-1");
      data.completeSignInLink.mockRejectedValueOnce(new data.SignInError(reason));
      await renderProvider(LINK);
      act(() => data.emit(null));
      await waitFor(() => expect(state()).toBe("signed-out | failed | idle | /"));
      expect(context.link).toEqual({ status: "failed", reason, retryable: true });
      expect(JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "null")).toMatchObject({
        email: "member@example.org",
      });

      act(() => context.retryLink());
      await waitFor(() => expect(state()).toContain("/labs/lab-1"));
      expect(data.completeSignInLink).toHaveBeenCalledTimes(2);
      expect(data.completeSignInLink).toHaveBeenLastCalledWith("member@example.org", LINK);
      expect(state()).toContain("| none |");
      expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
    },
  );

  it("can try again with the address that was typed, after a failure that left the link usable", async () => {
    await renderProvider(LINK);
    act(() => data.emit(null));
    data.completeSignInLink.mockRejectedValueOnce(new data.SignInError("network"));
    await act(async () => {
      await expect(context.confirmLinkEmail("member@example.org")).rejects.toBeInstanceOf(data.SignInError);
    });
    expect(context.link).toEqual({ status: "failed", reason: "network", retryable: true });

    act(() => context.retryLink());
    await waitFor(() => expect(state()).toContain("| none |"));
    expect(data.completeSignInLink).toHaveBeenLastCalledWith("member@example.org", LINK);
  });

  it("does not follow a destination outside the portal", async () => {
    rememberRequest("https://example.org/phish");
    await renderProvider(LINK, "/somewhere");
    await waitFor(() => expect(data.completeSignInLink).toHaveBeenCalled());
    await waitFor(() => expect(state()).toMatch(/\| \/$/));
  });

  it("says at once that a link was not used when an account is already signed in, and forgets the link", async () => {
    await renderProvider(LINK);
    expect(state()).toBe("loading | needs-email | idle | /");

    act(() => data.emit(member));

    await waitFor(() => expect(state()).toBe("signed-in | none | done | /"));
    expect(await screen.findByText("You are already signed in.", { selector: "div" })).toBeTruthy();
    expect(data.completeSignInLink).not.toHaveBeenCalled();
  });

  it("does not say that the link was unused when the link itself has just signed the visitor in", async () => {
    await renderProvider(LINK);
    act(() => data.emit(null));
    // Firebase reports the account before the call that completes the link returns.
    data.completeSignInLink.mockImplementationOnce(async () => {
      act(() => data.emit(member));
      return member;
    });
    await act(() => context.confirmLinkEmail("member@example.org"));
    await waitFor(() => expect(state()).toBe("signed-in | none | done | /"));
    expect(screen.queryByText("You are already signed in.")).toBeNull();
  });
});

describe("AuthProvider with a second factor", () => {
  const challenge = () => ({
    factors: [{ uid: "factor-1", displayName: "Phone", factorId: "totp", enrolledAt: null }],
    answer: vi.fn().mockResolvedValue(member),
  });

  it("waits for the second factor after the link, and goes where the visitor was heading once it is answered", async () => {
    rememberRequest("/labs/lab-1");
    const waiting = challenge();
    data.completeSignInLink.mockRejectedValueOnce(new data.SecondFactorChallengeError(waiting));
    await renderProvider(LINK);
    act(() => data.emit(null));
    await waitFor(() => expect(state()).toBe("signed-out | second-factor | idle | /"));

    await act(() => context.answerSecondFactor("factor-1", "123456"));
    expect(waiting.answer).toHaveBeenCalledExactlyOnceWith("factor-1", "123456");
    expect(state()).toBe("signed-out | none | idle | /labs/lab-1");
    // The address is forgotten once the sign-in has finished.
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("keeps the challenge open when the code is refused", async () => {
    rememberRequest(null);
    const waiting = challenge();
    waiting.answer.mockRejectedValueOnce(new Error("invalid-code"));
    data.completeSignInLink.mockRejectedValueOnce(new data.SecondFactorChallengeError(waiting));
    await renderProvider(LINK);
    act(() => data.emit(null));
    await waitFor(() => expect(state()).toContain("second-factor"));

    await expect(context.answerSecondFactor("factor-1", "000000")).rejects.toThrow("invalid-code");
    expect(state()).toBe("signed-out | second-factor | idle | /");
    expect(window.localStorage.getItem(PENDING_KEY)).not.toBeNull();
  });

  it("asks for the second factor after Google sign-in as well", async () => {
    data.signInWithGoogle.mockRejectedValueOnce(new data.SecondFactorChallengeError(challenge()));
    await renderProvider();
    act(() => data.emit(null));
    await act(() => context.signInWithGoogle());
    expect(state()).toBe("signed-out | second-factor | idle | /");
  });
});

describe("AuthProvider signing out everywhere", () => {
  it("asks the server to end every session, then signs out here with its own confirmation", async () => {
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("done"));

    await act(() => context.signOutEverywhere());
    expect(data.callFunction).toHaveBeenCalledOnce();
    expect(data.callFunction.mock.calls[0]?.[0]).toMatchObject({ name: "endAllSessions" });
    expect(data.signOut).toHaveBeenCalledOnce();
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBe("signed-out-everywhere");
  });

  it("stays signed in when the server refuses", async () => {
    data.callFunction.mockRejectedValueOnce(new data.CallableError("unavailable"));
    await renderProvider();
    act(() => data.emit(member));
    await waitFor(() => expect(state()).toContain("done"));

    await expect(context.signOutEverywhere()).rejects.toThrow();
    expect(data.signOut).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(NOTICE_KEY)).toBeNull();
  });
});
