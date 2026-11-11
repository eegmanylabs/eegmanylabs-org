// Several live values seen as one, for a view that needs all of them before it can show
// anything true: it loads while any loads, fails when any fails, and is ready when all are.
import type { Live } from "@/data";

type Values<T extends readonly Live<unknown>[]> = { readonly [I in keyof T]: T[I] extends Live<infer V> ? V : never };

/**
 * Combines live values. A value that is idle, because nothing was asked for, keeps the whole
 * idle: wrap it in `orEmpty` where nothing asked for means an empty list.
 */
export function combineLive<T extends readonly Live<unknown>[], R>(
  lives: T,
  combine: (...values: Values<T>) => R,
): Live<R> {
  for (const live of lives) if (live.status === "error") return live;
  if (lives.some((live) => live.status === "loading")) return { status: "loading" };
  if (lives.some((live) => live.status === "idle")) return { status: "idle" };
  const values = lives.map((live) => (live.status === "ready" ? live.data : undefined)) as unknown as Values<T>;
  return {
    status: "ready",
    data: combine(...values),
    fromCache: lives.some((live) => live.status === "ready" && live.fromCache),
    hasPendingWrites: lives.some((live) => live.status === "ready" && live.hasPendingWrites),
  };
}

const EMPTY: Live<readonly never[]> = { status: "ready", data: [], fromCache: false, hasPendingWrites: false };

/** An idle value stands for an empty list, where a list was deliberately not asked for. */
export function orEmpty<T>(live: Live<readonly T[]>): Live<readonly T[]> {
  return live.status === "idle" ? EMPTY : live;
}
