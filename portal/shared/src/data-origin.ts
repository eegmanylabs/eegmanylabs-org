import { z } from "./zod";

/**
 * Where a stored value came from. Every document carries one, and the interface labels values
 * accordingly wherever they are displayed.
 *
 * | Value      | Meaning                                                  |
 * |------------|----------------------------------------------------------|
 * | `live`     | Created or changed through the portal                    |
 * | `imported` | Created by an importer from a historical source          |
 * | `demo`     | Synthetic demonstration data written by `seed:demo`      |
 */
export const DATA_ORIGINS = ["live", "imported", "demo"] as const;
export const dataOriginSchema = z.enum(DATA_ORIGINS);
export type DataOrigin = z.output<typeof dataOriginSchema>;
