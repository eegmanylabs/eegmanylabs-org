// The guard of the registry pages: an account that is not linked to a member profile is asked to
// link itself, with the address it followed kept. Identifiers are synthetic.
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessRecord } from "@/data";
import type { AuthStub } from "@/test-support/auth-stub";
import { claimPathFor, RequireLinked } from "./RequireLinked";

const auth = vi.hoisted(() => ({ value: {} as AuthStub }));
vi.mock("./AuthProvider", () => ({ useAuth: () => auth.value }));

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <RequireLinked />,
        children: [
          { path: "/labs/:id", element: <p>Laboratory page</p> },
          { path: "/pages", element: <p>Workspace page</p>, handle: { title: "Workspace" } },
        ],
      },
      { path: "/claim", element: <p>Claim page</p> },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

const accessWith = (personId: string | null) =>
  ({ status: "ready", data: { personId } as AccessRecord, fromCache: false, hasPendingWrites: false }) as const;

beforeEach(() => {
  auth.value = { access: { status: "loading" } };
});

describe("RequireLinked", () => {
  it("shows the page to an account linked to a member profile", () => {
    auth.value.access = accessWith("person-1");
    renderAt("/labs/lab-1");
    expect(screen.getByText("Laboratory page")).toBeTruthy();
  });

  it("asks an account that is not linked to link itself, and keeps the address it followed", () => {
    auth.value.access = accessWith(null);
    renderAt("/labs/lab-1?tab=members");
    expect(screen.queryByText("Laboratory page")).toBeNull();
    expect(screen.getByText("Link your account to your member profile to see this page.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Link your account" }).getAttribute("href")).toBe(
      claimPathFor("/labs/lab-1?tab=members"),
    );
  });

  it("keeps the title of the section as the heading of the refusal", () => {
    auth.value.access = accessWith(null);
    renderAt("/pages");
    expect(screen.getByRole("heading", { level: 1, name: "Workspace" })).toBeTruthy();
    renderAt("/labs/lab-1");
    expect(screen.getByRole("heading", { level: 1, name: "Members only" })).toBeTruthy();
  });

  it("waits for the access document before it decides", () => {
    renderAt("/labs/lab-1");
    expect(screen.queryByText("Laboratory page")).toBeNull();
    expect(screen.queryByText("Link your account")).toBeNull();
  });
});
