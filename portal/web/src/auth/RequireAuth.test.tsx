// Addresses are synthetic and use the example.org domain.
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStub } from "@/test-support/auth-stub";
import { RequireAuth } from "./RequireAuth";

const auth = vi.hoisted(() => ({ value: {} as AuthStub }));
vi.mock("./AuthProvider", () => ({ useAuth: () => auth.value }));

function SignInStandIn() {
  const location = useLocation();
  return <p data-testid="sign-in">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/labs/:id",
        element: (
          <RequireAuth>
            <p>Protected page</p>
          </RequireAuth>
        ),
      },
      {
        path: "/",
        element: (
          <RequireAuth>
            <p>Home</p>
          </RequireAuth>
        ),
      },
      { path: "/login", element: <SignInStandIn /> },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  auth.value = { session: { status: "signed-out" }, link: { status: "none" } };
});

describe("RequireAuth", () => {
  it("shows the page to a signed-in account", () => {
    auth.value.session = {
      status: "signed-in",
      user: { uid: "uid-1", email: "member@example.org", displayName: null, signedInAt: 1_700_000_000 },
    };
    renderAt("/labs/lab-1");
    expect(screen.getByText("Protected page")).toBeTruthy();
  });

  it("sends a signed-out visitor to the sign-in page and remembers the page they asked for", () => {
    renderAt("/labs/lab-1?tab=people");
    expect(screen.queryByText("Protected page")).toBeNull();
    expect(screen.getByTestId("sign-in").textContent).toBe("/login?next=%2Flabs%2Flab-1%3Ftab%3Dpeople");
  });

  it("sends a signed-out visitor from Home to the plain sign-in address", () => {
    renderAt("/");
    expect(screen.getByTestId("sign-in").textContent).toBe("/login");
  });

  it.each([
    ["the session is not known yet", { session: { status: "loading" }, link: { status: "none" } }],
    ["a sign-in link is being completed", { session: { status: "signed-out" }, link: { status: "completing" } }],
  ] as const)("waits, showing neither the page nor the sign-in page, while %s", (_label, state) => {
    auth.value = state;
    renderAt("/labs/lab-1");
    expect(screen.getByRole("status").textContent).toBe("Checking your sign-in");
    expect(screen.queryByText("Protected page")).toBeNull();
    expect(screen.queryByTestId("sign-in")).toBeNull();
  });
});
