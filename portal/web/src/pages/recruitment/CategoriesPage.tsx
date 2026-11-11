// The categories of participant counts (docs/DATA_MODEL.md, section 7): the global categories,
// each with the definition that says exactly who is counted, and the categories that extend one
// replication. Administrators edit the global ones and the leads of a replication its own, all
// through `saveCountCategory`.
import { keySchema, saveCountCategoryContract } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, retryFailedLiveData, useLiveQuery } from "@/data";
import { combineLive } from "@/registry/combine";
import { useReplications } from "@/registry/queries";
import { ALL_CATEGORIES, type CategoryRecord } from "@/registry/recruitment-data";
import { useViewer, type Viewer } from "@/registry/viewer";

interface CategoryDialogProps {
  /** The category to edit, or null to add one. */
  readonly category: CategoryRecord | null;
  /** The replication a new category extends, or null for a global one. */
  readonly replicationId: string | null;
}

function CategoryDialog({ category, replicationId }: CategoryDialogProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(category?.key ?? "");
  const [label, setLabel] = useState(category?.label ?? "");
  const [definition, setDefinition] = useState(category?.definition ?? "");
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = category?.replicationId ?? replicationId;

  const save = async (archived: boolean) => {
    const problems: Record<string, string> = {};
    if (!keySchema.safeParse(key).success) {
      problems.key = "Use letters and digits, with single hyphens or underscores between them, for example eyesClosed.";
    }
    if (label.trim() === "") problems.label = "Enter the name of the category.";
    if (definition.trim().length < 20) problems.definition = "Say exactly who is counted, in one sentence at least.";
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(saveCountCategoryContract, {
        key,
        create: category === null,
        label: label.trim(),
        definition: definition.trim(),
        replicationId: target,
        archived,
      });
      setOpen(false);
      toast.show({ title: archived ? "The category has been archived." : "The category has been saved." });
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The category was not saved. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={category === null ? "primary" : "ghost"}>
          {category === null ? (target === null ? "Add a global category" : `Add a category to ${target}`) : "Edit"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={category === null ? "Add a category" : `Edit ${category.label}`}
        description={
          target === null
            ? "A global category is counted by every replication."
            : `This category is counted by ${target} alone. Its key is never used by another replication.`
        }
      >
        <form
          noValidate
          className="mt-5 grid gap-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void save(false);
          }}
        >
          {failure === null ? null : <ErrorState title="Nothing was saved." description={failure} />}
          <FormField
            label="Key"
            hint="Reports name the category by this key, which never changes."
            error={errors.key ?? null}
          >
            {(control) => (
              <Input
                {...control}
                value={key}
                disabled={category !== null}
                onChange={(event) => setKey(event.target.value.trim())}
              />
            )}
          </FormField>
          <FormField label="Name" error={errors.label ?? null}>
            {(control) => (
              <Input {...control} maxLength={300} value={label} onChange={(event) => setLabel(event.target.value)} />
            )}
          </FormField>
          <FormField label="Definition" hint="Who is counted, exactly." error={errors.definition ?? null}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={2_000}
                value={definition}
                onChange={(event) => setDefinition(event.target.value)}
              />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving…" : "Save category"}
            </Button>
            {category !== null && !category.isCore && category.archivedAt === null ? (
              <Button disabled={busy} onClick={() => void save(true)}>
                Archive
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryList({
  categories,
  editable,
}: {
  readonly categories: readonly CategoryRecord[];
  readonly editable: boolean;
}) {
  if (categories.length === 0) return <p className="text-sm text-fg-muted">No categories.</p>;
  return (
    <dl className="grid gap-0 rounded-tile border border-border bg-surface">
      {categories.map((category) => (
        <div
          key={category.key}
          className="grid gap-1 border-b border-border p-3 last:border-b-0 sm:grid-cols-[14rem_1fr_auto] sm:gap-3"
        >
          <dt className="flex flex-wrap items-center gap-2 font-medium text-fg">
            {category.label}
            {category.archivedAt === null ? null : <Badge tone="outline">Archived</Badge>}
            <span className="text-xs font-normal text-fg-muted">{category.key}</span>
          </dt>
          <dd className="text-sm text-fg-secondary">{category.definition}</dd>
          <dd>
            {editable ? <CategoryDialog category={category} replicationId={category.replicationId ?? null} /> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Categories({
  viewer,
  categories,
  replicationIds,
}: {
  readonly viewer: Viewer;
  readonly categories: readonly CategoryRecord[];
  readonly replicationIds: readonly string[];
}) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("replication");
  const chosen = requested !== null && replicationIds.includes(requested) ? requested : null;
  const global = categories.filter((category) => category.replicationId === undefined);
  const managesLookups = viewer.access.member && viewer.can("lookups.manage", "programme");
  const extended = [
    ...new Set(
      categories.flatMap((category) => (category.replicationId === undefined ? [] : [category.replicationId])),
    ),
  ]
    .filter((id) => chosen === null || id === chosen)
    .sort();
  const managedReplications = replicationIds.filter(
    (id) => viewer.access.member && viewer.can("replications.manage", { replicationId: id }),
  );
  return (
    <div className="grid gap-6">
      <section aria-labelledby="global" className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="global" className="text-lg text-fg">
            Global categories
          </h2>
          {managesLookups ? <CategoryDialog category={null} replicationId={null} /> : null}
        </div>
        <CategoryList categories={global} editable={managesLookups} />
      </section>
      <section aria-labelledby="extensions" className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="extensions" className="text-lg text-fg">
            Categories of one replication
          </h2>
          <FormField label="Replication">
            {(control) => (
              <Select
                {...control}
                value={chosen ?? ""}
                onChange={(event) =>
                  setParams(
                    (current) => {
                      const next = new URLSearchParams(current);
                      if (event.target.value === "") next.delete("replication");
                      else next.set("replication", event.target.value);
                      return next;
                    },
                    { replace: true },
                  )
                }
              >
                <option value="">Every replication</option>
                {replicationIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </div>
        {chosen !== null && managedReplications.includes(chosen) ? (
          <div>
            <CategoryDialog category={null} replicationId={chosen} />
          </div>
        ) : null}
        {extended.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {chosen === null
              ? "No replication has categories of its own."
              : `${chosen} counts the global categories alone.`}
          </p>
        ) : (
          extended.map((replicationId) => (
            <div key={replicationId} className="grid gap-2">
              <h3 className="text-md text-fg">{replicationId}</h3>
              <CategoryList
                categories={categories.filter((category) => category.replicationId === replicationId)}
                editable={managedReplications.includes(replicationId)}
              />
            </div>
          ))
        )}
        {chosen === null && managedReplications.length > 0 ? (
          <p className="text-sm text-fg-secondary">Choose one of your replications to add a category to it.</p>
        ) : null}
      </section>
    </div>
  );
}

export function CategoriesPage() {
  const viewer = useViewer();
  const categories = useLiveQuery(ALL_CATEGORIES);
  const replications = useReplications();
  const live = combineLive([categories, replications] as const, (items, replicationItems) => ({
    categories: [...items].sort((a, b) => a.position - b.position || (a.key < b.key ? -1 : 1)),
    replicationIds: replicationItems.map((replication) => replication.id).sort(),
  }));
  return (
    <>
      <PageHeader
        title="Count categories"
        description="What each count of recruitment means. Every report names its counts by these categories, for the main experiment, the resting state and unique participants apart."
      />
      {viewer === null ? (
        <LoadingState label="Checking your access" />
      ) : (
        <LiveView
          live={live}
          loadingLabel="Loading the categories"
          errorTitle="The categories could not be loaded."
          onRetry={retryFailedLiveData}
        >
          {(loaded) => (
            <Categories viewer={viewer} categories={loaded.categories} replicationIds={loaded.replicationIds} />
          )}
        </LiveView>
      )}
    </>
  );
}
