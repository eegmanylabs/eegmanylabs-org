// A paged list draws one page of its items at a time. Items are synthetic.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LIST_PAGE_SIZE, PagedList } from "./paged-list";

const items = (count: number) => Array.from({ length: count }, (_, index) => `Synthetic item ${index + 1}`);

function list(count: number) {
  return render(
    <PagedList items={items(count)} label="items" keyOf={(item) => item} aria-label="Synthetic items">
      {(item) => <span>{item}</span>}
    </PagedList>,
  );
}

describe("PagedList", () => {
  it("draws every item of a short list, without pagination", () => {
    list(3);
    expect(within(screen.getByRole("list", { name: "Synthetic items" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("draws one page of a long list at a time and moves between pages", () => {
    list(LIST_PAGE_SIZE * 2 + 7);
    const rows = () => within(screen.getByRole("list", { name: "Synthetic items" })).getAllByRole("listitem");
    expect(rows()).toHaveLength(LIST_PAGE_SIZE);
    expect(screen.getByText(`Showing 1 to ${LIST_PAGE_SIZE} of ${LIST_PAGE_SIZE * 2 + 7} items`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(rows()).toHaveLength(7);
    expect(rows()[0]?.textContent).toBe(`Synthetic item ${LIST_PAGE_SIZE * 2 + 1}`);
  });
});
