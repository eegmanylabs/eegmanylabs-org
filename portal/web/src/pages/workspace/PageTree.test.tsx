// The tree of pages draws fifty pages of a branch at first, with Show more for the rest. Pages
// are synthetic.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { RecordOf } from "@/data";
import { BRANCH_PAGE_SIZE, PageTree } from "./PageTree";

vi.mock("@/data", () => ({ updatePageFields: vi.fn() }));

const page = (index: number, parentPageId: string | null = null) =>
  ({
    id: `page-${index}`,
    title: `Synthetic page ${index}`,
    parentPageId,
    order: String(index).padStart(5, "0"),
    archivedAt: null,
  }) as unknown as RecordOf<"pages">;

describe("PageTree", () => {
  it("draws the first pages of a long branch and adds more on request", () => {
    const count = BRANCH_PAGE_SIZE * 2 + 3;
    render(
      <MemoryRouter>
        <PageTree pages={Array.from({ length: count }, (_, index) => page(index))} />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("link")).toHaveLength(BRANCH_PAGE_SIZE);
    fireEvent.click(
      screen.getByRole("button", { name: `Show ${BRANCH_PAGE_SIZE} more of ${count - BRANCH_PAGE_SIZE} pages` }),
    );
    expect(screen.getAllByRole("link")).toHaveLength(BRANCH_PAGE_SIZE * 2);
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more of 3 pages" }));
    expect(screen.getAllByRole("link")).toHaveLength(count);
    expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
  });
});
