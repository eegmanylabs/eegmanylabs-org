// Dashboards (docs/DATA_MODEL.md, section 9): a grid of widgets, each a view, a figure from a
// rollup, a chart of a grouped count or sum, the activity of the scope or a note. The layout
// logic is pure, so the mouse, the keyboard and the functions place widgets the same way.
import { LIMITS } from "../schemas/base";
import { viewTypeSchema } from "../schemas/workspace";
import { z } from "../zod";
import { rollupFunctionSchema, viewCollectionKeySchema, viewConfigSchema, viewScopeSchema } from "./model";

/** The number of columns of the grid. */
export const GRID_COLUMNS = 12;
/** The most rows a widget may span, and the lowest row it may start on. */
export const WIDGET_MAX_HEIGHT = 12;
export const GRID_MAX_ROW = 200;

/** The title that every widget shows above its content. */
const title = z.string().trim().min(1).max(100);

const measureSchema = z.union([
  z.strictObject({ kind: z.literal("count") }),
  z.strictObject({ kind: z.literal("sum"), property: z.string().min(1).max(LIMITS.shortText) }),
  z.strictObject({
    kind: z.literal("rollup"),
    property: z.string().min(1).max(LIMITS.shortText),
    function: rollupFunctionSchema,
  }),
]);

/** A view of a collection: a saved view, or a configuration of its own. */
export const viewWidgetConfigSchema = z.strictObject({
  title,
  collectionKey: viewCollectionKeySchema,
  viewId: z.string().min(1).max(LIMITS.identifier).optional(),
  type: viewTypeSchema,
  config: viewConfigSchema,
  scope: viewScopeSchema.nullable(),
});

/** A figure: a count, a sum or a rollup function over the records of a collection that pass a view. */
export const kpiWidgetConfigSchema = z.strictObject({
  title,
  collectionKey: viewCollectionKeySchema,
  config: viewConfigSchema,
  scope: viewScopeSchema.nullable(),
  measure: measureSchema,
});

/** A bar chart of a count or a sum for each group of a property. */
export const chartWidgetConfigSchema = z.strictObject({
  title,
  collectionKey: viewCollectionKeySchema,
  config: viewConfigSchema,
  scope: viewScopeSchema.nullable(),
  groupBy: z.string().min(1).max(LIMITS.shortText),
  measure: measureSchema,
});

export const activityWidgetConfigSchema = z.strictObject({ title, limit: z.number().int().min(1).max(50) });
export const noteWidgetConfigSchema = z.strictObject({ title, text: z.string().max(LIMITS.longText) });

const position = {
  x: z
    .number()
    .int()
    .min(0)
    .max(GRID_COLUMNS - 1),
  y: z.number().int().min(0).max(GRID_MAX_ROW),
  w: z.number().int().min(1).max(GRID_COLUMNS),
  h: z.number().int().min(1).max(WIDGET_MAX_HEIGHT),
};

/** A widget as a dashboard stores it: its kind, its configuration with its title, and its place. */
export const dashboardWidgetInputSchema = z
  .discriminatedUnion("type", [
    z.strictObject({ type: z.literal("view"), config: viewWidgetConfigSchema, ...position }),
    z.strictObject({ type: z.literal("kpi"), config: kpiWidgetConfigSchema, ...position }),
    z.strictObject({ type: z.literal("chart"), config: chartWidgetConfigSchema, ...position }),
    z.strictObject({
      type: z.literal("activity"),
      config: activityWidgetConfigSchema,
      ...position,
    }),
    z.strictObject({ type: z.literal("note"), config: noteWidgetConfigSchema, ...position }),
  ])
  .refine((widget) => widget.x + widget.w <= GRID_COLUMNS, { error: "A widget stays within the twelve columns" });
export type DashboardWidget = z.output<typeof dashboardWidgetInputSchema>;

/** The place of a widget on the grid. */
export interface Placement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const overlaps = (a: Placement, b: Placement): boolean =>
  a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/**
 * Moves every widget as far up as it goes without overlapping one above it, in reading order,
 * so the grid has no holes. The widget named `pinned` keeps its place and the others make room.
 */
export function compactLayout(layout: readonly Placement[], pinned: string | null = null): Placement[] {
  const fixed = layout.find((placement) => placement.id === pinned);
  const placed: Placement[] = fixed === undefined ? [] : [fixed];
  const others = layout
    .filter((placement) => placement.id !== pinned)
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  for (const placement of others) {
    let y = 0;
    let candidate = { ...placement, y };
    while (placed.some((other) => overlaps(candidate, other))) {
      y += 1;
      candidate = { ...placement, y };
    }
    placed.push(candidate);
  }
  const order = new Map(layout.map((placement, index) => [placement.id, index]));
  return placed.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Moves a widget by whole cells, within the grid, and makes room for it. */
export function moveWidget(layout: readonly Placement[], id: string, dx: number, dy: number): Placement[] {
  return compactLayout(
    layout.map((placement) =>
      placement.id === id
        ? {
            ...placement,
            x: clamp(placement.x + dx, 0, GRID_COLUMNS - placement.w),
            y: clamp(placement.y + dy, 0, GRID_MAX_ROW),
          }
        : placement,
    ),
    id,
  );
}

/** Places a widget at a cell, as a drag with the pointer ends, and makes room for it. */
export function placeWidget(layout: readonly Placement[], id: string, x: number, y: number): Placement[] {
  const current = layout.find((placement) => placement.id === id);
  if (current === undefined) return [...layout];
  return moveWidget(layout, id, x - current.x, y - current.y);
}

/** Changes the width and the height of a widget by whole cells, within the grid, and makes room for it. */
export function resizeWidget(layout: readonly Placement[], id: string, dw: number, dh: number): Placement[] {
  return compactLayout(
    layout.map((placement) =>
      placement.id === id
        ? {
            ...placement,
            w: clamp(placement.w + dw, 1, GRID_COLUMNS - placement.x),
            h: clamp(placement.h + dh, 1, WIDGET_MAX_HEIGHT),
          }
        : placement,
    ),
    id,
  );
}

/** The place for a new widget: below every other, across the width it asks for. */
export function nextPlacement(layout: readonly Placement[], id: string, w: number, h: number): Placement {
  const bottom = layout.reduce((lowest, placement) => Math.max(lowest, placement.y + placement.h), 0);
  return { id, x: 0, y: bottom, w: clamp(w, 1, GRID_COLUMNS), h: clamp(h, 1, WIDGET_MAX_HEIGHT) };
}

/**
 * The widgets that the dashboard of the programme, a replication or a laboratory starts with:
 * figures and a chart of its participations, the participations themselves, and its activity.
 * The participations are the same documents on every dashboard (D-011), scoped to the record.
 */
export function defaultDashboardWidgets(
  scopeType: "programme" | "replication" | "laboratory",
  scopeId: string,
): Record<string, DashboardWidget> {
  const scope =
    scopeType === "programme"
      ? null
      : { property: scopeType === "replication" ? "replication" : "laboratory", value: scopeId };
  const participations = { collectionKey: "core:participations", scope } as const;
  return {
    participationCount: {
      type: "kpi",
      config: { title: "Participations", ...participations, config: {}, measure: { kind: "count" } },
      x: 0,
      y: 0,
      w: 3,
      h: 2,
    },
    collecting: {
      type: "kpi",
      config: {
        title: "Collecting data",
        ...participations,
        config: { filter: { kind: "condition", property: "status", operator: "equals", value: "collecting" } },
        measure: { kind: "count" },
      },
      x: 3,
      y: 0,
      w: 3,
      h: 2,
    },
    targetMain: {
      type: "kpi",
      config: {
        title: "Target, main experiment",
        ...participations,
        config: {},
        measure: { kind: "sum", property: "targetNMain" },
      },
      x: 6,
      y: 0,
      w: 3,
      h: 2,
    },
    readiness: {
      type: "kpi",
      config: {
        title: "Average checklist completion",
        ...participations,
        config: {},
        measure: { kind: "rollup", property: "checklistCompletion", function: "average" },
      },
      x: 9,
      y: 0,
      w: 3,
      h: 2,
    },
    byStatus: {
      type: "chart",
      config: {
        title: "Participations by status",
        ...participations,
        config: {},
        groupBy: "status",
        measure: { kind: "count" },
      },
      x: 0,
      y: 2,
      w: 6,
      h: 4,
    },
    activity: { type: "activity", config: { title: "Recent activity", limit: 10 }, x: 6, y: 2, w: 6, h: 4 },
    participations: {
      type: "view",
      config: {
        title: "Participations",
        ...participations,
        type: "table",
        config: {
          hidden: scopeType === "replication" ? ["replication"] : scopeType === "laboratory" ? ["laboratory"] : [],
          sorts: [{ property: "participation", direction: "ascending" }],
        },
      },
      x: 0,
      y: 6,
      w: 12,
      h: 6,
    },
  };
}
