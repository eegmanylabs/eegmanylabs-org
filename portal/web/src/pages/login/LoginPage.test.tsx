// Addresses are synthetic and use the example.org domain.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStub } from "@/test-support/auth-stub";

// The page is tested without Firebase: the data layer and the auth context are replaced.
const data = vi.hoisted(() => {
  class SignInError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  }
  return { googleSignInAvailable: false, SignInError };
});
vi.mock("@/data", () => data);

const auth = vi.hoisted(() => ({ value: {} as AuthStub }));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => auth.value }));

async function renderLogin(path = "/login") {
  // Imported after the mocks are in place, and again for each test so the flag is read afresh.
  vi.resetModules();
  const { LoginPage } = await import("./LoginPage");
  const router = createMemoryRouter(
    [
      { path: "/login", element: <LoginPage /> },
      { path: "*", element: <p data-testid="elsewhere">Signed-in destination</p> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const CONFIRMATION = /If the address you entered can receive email, a sign-in link is on its way/;

beforeEach(() => {
  data.googleSignInAvailable = false;
  auth.value = {
    session: { status: "signed-out" },
    link: { status: "none" },
    sendLink: vi.fn().mockResolvedValue(undefined),
    forgetLinkRequest: vi.fn(),
    confirmLinkEmail: vi.fn().mockResolvedValue(undefined),
    retryLink: vi.fn(),
    abandonLink: vi.fn(),
    signInWithGoogle: vi.fn().mockResolvedValue(undefined),
  };
});

describe("the sign-in page", () => {
  it("asks for a link to the trimmed address and remembers where the visitor was going", async () => {
    const user = userEvent.setup();
    await renderLogin("/login?next=%2Flabs%2Flab-1");
    await user.type(screen.getByLabelText("Email address"), "  member@example.org ");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(auth.value.sendLink).toHaveBeenCalledWith("member@example.org", "/labs/lab-1");
    expect(await screen.findByText(CONFIRMATION)).toBeTruthy();
  });

  it("shows the same confirmation when the service refuses the address", async () => {
    const user = userEvent.setup();
    auth.value.sendLink = vi.fn().mockRejectedValue(new data.SignInError("account-disabled"));
    await renderLogin();
    await user.type(screen.getByLabelText("Email address"), "disabled.account@example.org");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByText(CONFIRMATION)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the same confirmation for every outcome that depends on the address", async () => {
    const texts: (string | null)[] = [];
    const outcomes = [
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockRejectedValue(new data.SignInError("address-refused")),
      vi.fn().mockRejectedValue(new data.SignInError("account-disabled")),
    ];
    for (const sendLink of outcomes) {
      const user = userEvent.setup();
      auth.value.sendLink = sendLink;
      await renderLogin();
      await user.type(screen.getByLabelText("Email address"), "member@example.org");
      await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
      await screen.findByText(CONFIRMATION);
      expect(screen.queryByRole("alert")).toBeNull();
      texts.push(document.body.textContent);
      cleanup();
    }
    expect(texts[1]).toBe(texts[0]);
    expect(texts[2]).toBe(texts[0]);
  });

  // None of these depends on who has an account, so saying that no link went out reveals nothing.
  it.each(["service-unavailable", "unknown", "link-invalid"])(
    "says that no link was sent when the service refuses the request with %s",
    async (reason) => {
      const user = userEvent.setup();
      auth.value.sendLink = vi.fn().mockRejectedValue(new data.SignInError(reason));
      await renderLogin();
      await user.type(screen.getByLabelText("Email address"), "member@example.org");
      await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("The link could not be sent.");
      expect(alert.textContent).toContain("Try again later.");
      expect(screen.queryByText(CONFIRMATION)).toBeNull();
      // The form is still there, with what was typed, for another try.
      expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("member@example.org");
    },
  );

  it("says that no link was sent when the failure is not one of the sign-in service at all", async () => {
    const user = userEvent.setup();
    auth.value.sendLink = vi.fn().mockRejectedValue(new Error("something unforeseen"));
    await renderLogin();
    await user.type(screen.getByLabelText("Email address"), "member@example.org");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The link could not be sent.");
    expect(screen.queryByText(CONFIRMATION)).toBeNull();
  });

  it("marks the field when the service does not accept the value as an address", async () => {
    const user = userEvent.setup();
    auth.value.sendLink = vi.fn().mockRejectedValue(new data.SignInError("invalid-email"));
    await renderLogin();
    const field = screen.getByLabelText("Email address");
    await user.type(field, "odd@example.org");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByText(/Enter a full email address/)).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText(CONFIRMATION)).toBeNull();
  });

  it("repeats the address that was typed in the confirmation and moves focus to it", async () => {
    const user = userEvent.setup();
    await renderLogin();
    await user.type(screen.getByLabelText("Email address"), "membr@example.org");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect((await screen.findByTestId("entered-address")).textContent).toBe("membr@example.org");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Check your email" }));
  });

  it("forgets the address and gives the field focus when the visitor wants to use a different one", async () => {
    const user = userEvent.setup();
    await renderLogin();
    await user.type(screen.getByLabelText("Email address"), "membr@example.org");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    await user.click(await screen.findByRole("button", { name: "Use a different address" }));

    expect(auth.value.forgetLinkRequest).toHaveBeenCalledOnce();
    const field = screen.getByLabelText("Email address") as HTMLInputElement;
    expect(field.value).toBe("");
    expect(document.activeElement).toBe(field);
  });

  it("says so when the sign-in service cannot be reached, because that says nothing about the address", async () => {
    const user = userEvent.setup();
    auth.value.sendLink = vi.fn().mockRejectedValue(new data.SignInError("network"));
    await renderLogin();
    await user.type(screen.getByLabelText("Email address"), "member@example.org");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The link could not be requested.");
    expect(screen.queryByText(CONFIRMATION)).toBeNull();
  });

  it("does not send anything for a value that is not an email address", async () => {
    const user = userEvent.setup();
    await renderLogin();
    await user.type(screen.getByLabelText("Email address"), "not-an-address");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(auth.value.sendLink).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email address").getAttribute("aria-invalid")).toBe("true");
  });

  it("moves focus to the field after a submit that was refused, so its message is read out", async () => {
    const user = userEvent.setup();
    await renderLogin();
    const field = screen.getByLabelText("Email address");
    await user.type(field, "not-an-address");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(document.activeElement).toBe(field);
    const message = screen.getByText(/Enter a full email address/).closest("p");
    expect(field.getAttribute("aria-describedby")).toBe(message?.id);
  });

  it("takes the message away as soon as the value changes", async () => {
    const user = userEvent.setup();
    await renderLogin();
    const field = screen.getByLabelText("Email address");
    await user.type(field, "not-an-address");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(field.getAttribute("aria-invalid")).toBe("true");

    await user.type(field, "@example.org");

    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText(/Enter a full email address/)).toBeNull();
  });

  it("offers no Google sign-in in a build without it", async () => {
    await renderLogin();
    expect(screen.queryByRole("button", { name: /Google/ })).toBeNull();
  });

  it("offers Google sign-in in a build with it, and starts it on request", async () => {
    const user = userEvent.setup();
    data.googleSignInAvailable = true;
    await renderLogin();
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(auth.value.signInWithGoogle).toHaveBeenCalledOnce();
  });

  it("explains a blocked pop-up window and stays quiet when the visitor closes the window", async () => {
    const user = userEvent.setup();
    data.googleSignInAvailable = true;
    auth.value.signInWithGoogle = vi
      .fn()
      .mockRejectedValueOnce(new data.SignInError("cancelled"))
      .mockRejectedValueOnce(new data.SignInError("popup-blocked"));
    await renderLogin();

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(screen.queryByRole("alert")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Allow pop-up windows");
  });

  it("asks for the address again when a link was opened in another browser", async () => {
    const user = userEvent.setup();
    auth.value.link = { status: "needs-email" };
    auth.value.confirmLinkEmail = vi.fn().mockRejectedValue(new data.SignInError("email-mismatch"));
    await renderLogin();
    expect(screen.getByRole("heading", { level: 1, name: "Confirm your email address" })).toBeTruthy();

    await user.type(screen.getByLabelText("Email address"), "someone.else@example.org");
    await user.click(screen.getByRole("button", { name: "Finish signing in" }));

    expect(auth.value.confirmLinkEmail).toHaveBeenCalledWith("someone.else@example.org");
    expect(await screen.findByText(/not the address this link was sent to/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Email address"));
  });

  it("lets a visitor who was asked for the address give up on the link and ask for a new one", async () => {
    const user = userEvent.setup();
    auth.value.link = { status: "needs-email" };
    await renderLogin();
    await user.click(screen.getByRole("button", { name: "Ask for a new link" }));
    expect(auth.value.abandonLink).toHaveBeenCalledOnce();
    expect(auth.value.confirmLinkEmail).not.toHaveBeenCalled();
  });

  it("says that a link no longer works and offers a new one", async () => {
    auth.value.link = { status: "failed", reason: "link-invalid", retryable: false };
    await renderLogin();
    expect(screen.getByRole("alert").textContent).toContain("That sign-in link no longer works.");
    expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("does not call a link spent when the sign-in service could not be reached, and offers to try it again", async () => {
    const user = userEvent.setup();
    auth.value.link = { status: "failed", reason: "network", retryable: true };
    await renderLogin();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The portal could not reach the sign-in service.");
    expect(alert.textContent).toContain("Your link has not been used.");
    expect(alert.textContent).not.toContain("no longer works");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(auth.value.retryLink).toHaveBeenCalledOnce();
  });

  it("tells the holder of a suspended account how to ask about it, and does not send them round for new links", async () => {
    auth.value.link = { status: "failed", reason: "account-disabled", retryable: false };
    await renderLogin();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("This account has been suspended.");
    expect(screen.getByRole("link", { name: /Contact the programme/ }).getAttribute("href")).toBe(
      "https://eegmanylabs.org/contact/",
    );
    expect(alert.textContent).not.toContain("no longer works");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("keeps saying that the account is suspended after a suspended account has signed out", async () => {
    auth.value.suspendedNotice = true;
    await renderLogin();
    expect(screen.getByRole("alert").textContent).toContain("This account has been suspended.");
  });

  it.each(["unknown", "service-unavailable"] as const)(
    "says that signing in did not finish after a failure with %s, and offers another try",
    async (reason) => {
      auth.value.link = { status: "failed", reason, retryable: true };
      await renderLogin();
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Signing in did not finish.");
      expect(alert.textContent).not.toContain("no longer works");
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    },
  );

  it("sends a signed-in visitor on to the page they asked for, and only to a page inside the portal", async () => {
    auth.value.session = {
      status: "signed-in",
      user: {
        uid: "uid-1",
        email: "member@example.org",
        displayName: null,
        signedInAt: 1_700_000_000,
        secondFactor: false,
      },
    };
    const router = await renderLogin("/login?next=%2Flabs%2Flab-1");
    expect(screen.getByTestId("elsewhere")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/labs/lab-1");

    const hostile = await renderLogin("/login?next=https%3A%2F%2Fexample.org%2Fphish");
    expect(hostile.state.location.pathname).toBe("/");
  });
});
