// What the dialog that adds a laboratory to a replication says when there is none to add: an
// empty registry, which is how a real project starts, or a registry whose laboratories all take
// part. Laboratory names are synthetic.
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { NoLaboratoryToAdd } from "./CreateParticipationDialog";

function renderWith(registeredCount: number, canCreate: boolean) {
  const router = createMemoryRouter(
    [{ path: "/", element: <NoLaboratoryToAdd registeredCount={registeredCount} canCreate={canCreate} /> }],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
}

describe("NoLaboratoryToAdd", () => {
  it("says that no laboratory is registered yet and leads to registering one", () => {
    renderWith(0, false);
    expect(screen.getByText(/No laboratory is registered in the portal yet/)).toBeTruthy();
    expect(screen.queryByText(/takes part in this replication already/)).toBeNull();
    expect(screen.getByRole("link", { name: "Register a laboratory" }).getAttribute("href")).toBe(
      "/labs?dialog=register",
    );
    expect(screen.queryByRole("link", { name: "Create a laboratory" })).toBeNull();
  });

  it("offers to create a laboratory to whoever may", () => {
    renderWith(0, true);
    expect(screen.getByRole("link", { name: "Create a laboratory" }).getAttribute("href")).toBe("/labs?dialog=create");
  });

  it("says that every laboratory takes part already only when laboratories exist", () => {
    renderWith(3, true);
    expect(screen.getByText("Every laboratory in the portal takes part in this replication already.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
