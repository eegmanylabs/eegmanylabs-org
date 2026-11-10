import { z } from "./zod";

/**
 * Where a stored fact came from. Fact-like documents carry one, and the interface labels the
 * last three wherever they are displayed (docs/DATA_MODEL.md, section 1).
 *
 * | Value                | Meaning                                                  |
 * |----------------------|----------------------------------------------------------|
 * | `live`               | Created or changed through the portal                    |
 * | `importedHistorical` | Created by an importer from a historical source          |
 * | `demo`               | Synthetic demonstration data written by `seed:demo`      |
 * | `projected`          | A forecast or a planned value, never an observation      |
 */
export const DATA_ORIGINS = ["live", "importedHistorical", "demo", "projected"] as const;
export const dataOriginSchema = z.enum(DATA_ORIGINS);
export type DataOrigin = z.output<typeof dataOriginSchema>;
