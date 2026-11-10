import { render, screen } from "@testing-library/react";
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
    confirmLinkEmail: vi.fn().mockResolvedValue(undefined),
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
  });

  it("says that a link no longer works and offers a new one", async () => {
    auth.value.link = { status: "failed", reason: "link-invalid" };
    await renderLogin();
    expect(screen.getByRole("alert").textContent).toContain("That sign-in link no longer works.");
    expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeTruthy();
  });

  it("sends a signed-in visitor on to the page they asked for, and only to a page inside the portal", async () => {
    auth.value.session = {
      status: "signed-in",
      user: { uid: "uid-1", email: "member@example.org", displayName: null },
    };
    const router = await renderLogin("/login?next=%2Flabs%2Flab-1");
    expect(screen.getByTestId("elsewhere")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/labs/lab-1");

    const hostile = await renderLogin("/login?next=https%3A%2F%2Fexample.org%2Fphish");
    expect(hostile.state.location.pathname).toBe("/");
  });
});
