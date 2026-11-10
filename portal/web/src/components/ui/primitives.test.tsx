import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test-support/render";
import { Badge } from "./badge";
import { Button } from "./button";
import { Dialog, DialogContent, DialogTrigger } from "./dialog";
import { EmptyState } from "./empty-state";
import { FormField } from "./form-field";
import { IconButton } from "./icon-button";
import { Input } from "./input";
import { Skeleton } from "./skeleton";
import { Spinner } from "./spinner";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "./table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { useToast } from "./toast";

describe("Button", () => {
  it("does not submit a form unless it is told to", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("type")).toBe("button");
  });

  it("can give its appearance to a link", () => {
    render(
      <Button asChild variant="primary">
        <a href="#/">Go to Home</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Go to Home" });
    expect(link.className).toContain("bg-accent-strong");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("puts white text on the deep coral of the primary action", () => {
    render(<Button variant="primary">Continue</Button>);
    const classes = screen.getByRole("button").className;
    expect(classes).toContain("bg-accent-strong");
    expect(classes).toContain("text-fg-on-accent");
  });
});

describe("IconButton", () => {
  it("takes its accessible name from its label", () => {
    renderWithProviders(
      <IconButton label="Collapse sidebar">
        <svg aria-hidden="true" />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
  });
});

describe("FormField", () => {
  it("ties the label, the hint and the error to the control", () => {
    const view = render(
      <FormField label="Email address" hint="We only use it to sign you in.">
        {(control) => <Input {...control} type="email" />}
      </FormField>,
    );
    const input = screen.getByLabelText("Email address");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    const hint = screen.getByText("We only use it to sign you in.");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);

    view.rerender(
      <FormField label="Email address" hint="We only use it to sign you in." error="Enter a full email address.">
        {(control) => <Input {...control} type="email" />}
      </FormField>,
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const error = screen.getByText("Enter a full email address.").closest("p");
    expect(error?.getAttribute("aria-live")).toBe("polite");
    expect(input.getAttribute("aria-describedby")).toBe(`${hint.id} ${error?.id}`);
  });
});

describe("Dialog", () => {
  it("opens with a name, closes with Escape and gives focus back to its trigger", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Edit details</Button>
        </DialogTrigger>
        <DialogContent title="Edit details" description="Changes are saved when you press Save.">
          <Button>Save</Button>
        </DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: "Edit details" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Edit details" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps its name when the title is hidden from view", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open navigation</Button>
        </DialogTrigger>
        <DialogContent title="Navigation" hideTitle placement="left">
          <a href="#/">Home</a>
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeTruthy();
  });
});

describe("Tabs", () => {
  it("shows one panel at a time and moves between tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="overview">
        <TabsList aria-label="Sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview panel</TabsContent>
        <TabsContent value="people">People panel</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Overview panel");

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "People" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("People panel");
  });
});

describe("Table", () => {
  it("is a named, keyboard-reachable region with column headers", () => {
    render(
      <Table caption="Laboratories">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>Country</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Synthetic laboratory</TableCell>
            <TableCell>United Kingdom</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const region = screen.getByRole("region", { name: "Laboratories" });
    expect(region.tabIndex).toBe(0);
    expect(screen.getByRole("table", { name: "Laboratories" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Name", "Country"]);
    expect(screen.getByRole("cell", { name: "Synthetic laboratory" })).toBeTruthy();
  });
});

describe("Badge, Skeleton, Spinner and EmptyState", () => {
  it("render what they say and hide what is only decoration", () => {
    const view = render(
      <>
        <Badge tone="accent">Not linked yet</Badge>
        <Skeleton className="h-4 w-10" />
        <Spinner label="Loading your account" />
        <EmptyState
          title="No tasks yet"
          description="Tasks appear here once someone adds one."
          action={<Button>Add a task</Button>}
        />
      </>,
    );
    expect(screen.getByText("Not linked yet").className).toContain("bg-tag-accent-bg");
    expect(view.container.querySelector('[aria-hidden="true"].animate-pulse')).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading your account");
    expect(screen.getByText("No tasks yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a task" })).toBeTruthy();
  });
});

function ToastTrigger({ onShown }: { onShown: () => void }) {
  const toast = useToast();
  return (
    <Button
      onClick={() => {
        toast.show({ title: "You have signed out.", description: "See you soon." });
        onShown();
      }}
    >
      Show
    </Button>
  );
}

describe("Toast", () => {
  it("shows a message that can be dismissed", async () => {
    const user = userEvent.setup();
    const onShown = vi.fn();
    renderWithProviders(<ToastTrigger onShown={onShown} />);
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(onShown).toHaveBeenCalledOnce();

    const title = screen.getByText("You have signed out.", { selector: "div" });
    const toast = title.closest("li") as HTMLElement;
    expect(within(toast).getByText("See you soon.")).toBeTruthy();

    await user.click(within(toast).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("See you soon.")).toBeNull();
  });

  it("cannot be used outside its provider", () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ToastTrigger onShown={() => {}} />)).toThrow(/ToastProvider/);
    silence.mockRestore();
  });
});
