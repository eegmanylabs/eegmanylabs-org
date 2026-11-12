// Every interface primitive on one page. EMULATOR BUILDS ONLY: the route is added in
// src/app/router.tsx when the build mode is "emulator", so staging and production contain
// neither the route nor this file.
//
// The page is a fixture for the browser tests (portal/tests/e2e/components.spec.ts), which
// check each primitive in a real browser for shadows, contrast, names and keyboard behaviour,
// including the primitives that no page of the portal uses yet. Add a primitive here in the
// change that adds it to src/components.
import { Plus } from "lucide-react";
import { useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { type SortDirection, SortHeader } from "@/components/ui/sort-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

// SYNTHETIC DATA. The rows are invented and describe nothing that exists.
const SAMPLE_ROWS = [
  { name: "Sample laboratory one", country: "United Kingdom", status: "Collecting" },
  { name: "Sample laboratory two", country: "Germany", status: "Preparing" },
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `section-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={id} className="grid gap-3 rounded-card border border-border bg-surface p-5">
      <h2 id={id} className="text-lg font-medium tracking-title text-fg-strong">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ComponentsPage() {
  const toast = useToast();
  const [presses, setPresses] = useState(0);
  const [note, setNote] = useState("");
  const [sort, setSort] = useState<SortDirection>("asc");
  const [offset, setOffset] = useState(0);
  const rows = [...SAMPLE_ROWS].sort((a, b) => (sort === "asc" ? 1 : -1) * a.name.localeCompare(b.name));
  const press = () => setPresses((count) => count + 1);

  return (
    <main className="mx-auto grid max-w-content gap-4 px-4 py-6 md:px-8">
      <PageHeader
        title="Interface components"
        description="Every primitive of the portal's interface, for the browser tests. This page exists in emulator builds only."
      />

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={press}>
            Primary action
          </Button>
          <Button onClick={press}>Other action</Button>
          <Button variant="ghost" onClick={press}>
            Quiet action
          </Button>
          <Button size="sm" onClick={press}>
            Small action
          </Button>
          <Button variant="primary" disabled>
            Unavailable action
          </Button>
          <IconButton label="Add one" onClick={press}>
            <Plus aria-hidden="true" strokeWidth={1.8} />
          </IconButton>
        </div>
        <p className="text-fg-secondary" data-testid="press-count">
          Buttons pressed: {presses}
        </p>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Ordinary state</Badge>
          <Badge tone="accent">Needs attention</Badge>
          <Badge tone="outline">Secondary fact</Badge>
          <Badge tone="solid">Most important state</Badge>
        </div>
      </Section>

      <Section title="Form fields">
        <div className="grid max-w-form gap-4">
          <FormField
            label="Note"
            hint="Up to twenty characters."
            error={note.length > 20 ? "Shorten the note to twenty characters." : null}
          >
            {(control) => <Input {...control} value={note} onChange={(event) => setNote(event.target.value)} />}
          </FormField>
          <FormField label="Field that cannot be changed">
            {(control) => <Input {...control} disabled defaultValue="Fixed value" />}
          </FormField>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="overview">
          <TabsList aria-label="Sample sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="closed" disabled>
              Closed section
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview">The overview panel.</TabsContent>
          <TabsContent value="people">The people panel.</TabsContent>
        </Tabs>
      </Section>

      <Section title="Horizontal scroll">
        <div className="w-60" data-testid="sample-horizontal-scroll">
          <HorizontalScroll>
            <div className="flex w-max gap-2 pb-1">
              <Button size="sm">First action</Button>
              <Button size="sm">Second action</Button>
              <Button size="sm">Third action</Button>
              <Button size="sm">Fourth action</Button>
            </div>
          </HorizontalScroll>
        </div>
      </Section>

      <Section title="Table">
        <Table caption="Sample laboratories">
          <TableHead>
            <TableRow>
              <SortHeader direction={sort} onSort={() => setSort(sort === "asc" ? "desc" : "asc")}>
                Name
              </SortHeader>
              <TableHeaderCell>Country</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.country}</TableCell>
                <TableCell>
                  <Badge>{row.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination offset={offset} pageSize={2} total={5} label="sample rows" onChange={setOffset} />
      </Section>

      {/* Kept below the sections that the first test uses, so that they stay where they were on the page. */}
      <Section title="More form fields">
        <div className="grid max-w-form gap-4">
          <FormField label="Longer text" hint="Several lines.">
            {(control) => <Textarea {...control} defaultValue="" />}
          </FormField>
          <FormField label="Choice">
            {(control) => (
              <Select {...control} defaultValue="second">
                <option value="first">First option</option>
                <option value="second">Second option</option>
              </Select>
            )}
          </FormField>
        </div>
      </Section>

      <Section title="Popover">
        <div>
          <Popover>
            <PopoverTrigger asChild>
              <Button>Open the panel</Button>
            </PopoverTrigger>
            <PopoverContent aria-label="Sample panel">
              <p className="p-2">A panel holds controls of its own.</p>
              <PopoverClose asChild>
                <Button size="sm">Close the panel</Button>
              </PopoverClose>
            </PopoverContent>
          </Popover>
        </div>
      </Section>

      <Section title="Dialog">
        <div>
          <Dialog>
            <DialogTrigger asChild>
              <Button>Open the dialog</Button>
            </DialogTrigger>
            <DialogContent title="Sample dialog" description="A dialog holds focus until it is closed.">
              <div className="mt-5 flex justify-end gap-2">
                <DialogClose asChild>
                  <Button>Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="primary" onClick={press}>
                    Confirm
                  </Button>
                </DialogClose>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </Section>

      <Section title="States">
        <EmptyState
          title="Nothing here yet"
          description="An empty state says why a view is empty and what would fill it."
          action={
            <Button onClick={() => toast.show({ title: "A notification", description: "It goes away by itself." })}>
              Show a notification
            </Button>
          }
        />
        <ErrorState
          title="Something could not be loaded."
          description="An error state says what happened and what to do next."
          action={
            <Button
              onClick={() => toast.show({ tone: "error", title: "It failed again.", description: "Try again later." })}
            >
              Show a failure notification
            </Button>
          }
        />
        <LoadingState label="Loading the sample" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </Section>
    </main>
  );
}
