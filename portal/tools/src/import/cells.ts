// From a cell of a workbook to the record of that cell in a source record
// (docs/MIGRATION_PLAN.md, section 2). The record holds what the file stores and, where the
// importer asks for it, the formatting that its source uses as data. Nothing is trimmed,
// converted or recomputed here.
import type { RawCell, RawScalar } from "./model";
import { isDateFormat, type WorkbookCell } from "./workbook";

/**
 * The formatting that an importer asks to be captured, because its source carries meaning in it.
 *
 * | Option   | Keys added to the record of a cell                                         |
 * |----------|----------------------------------------------------------------------------|
 * | `strike` | `strike`: true for a cell in strike-through                                |
 * | `fill`   | `fill`: the colour resolved through the theme, and `fillSource` as written |
 * | `font`   | `bold` and `italic`, for a tab that tells its rows apart by font           |
 * | `hidden` | `hiddenRow` and `hiddenColumn`                                             |
 * | `merge`  | `merge`: the merged range that contains the cell                           |
 */
export interface FormattingAsData {
  readonly strike?: boolean;
  readonly fill?: boolean;
  readonly font?: boolean;
  readonly hidden?: boolean;
  readonly merge?: boolean;
}

/**
 * The record of one cell: null for a cell that holds nothing, otherwise the stored value `v`
 * with its stored type `t`, the formula text `f`, the hyperlink target `l`, the number format
 * `z` of a number that the file shows as a date, and the formatting keys that were asked for.
 * For a formula, `v` is the cached result exactly as the file holds it.
 */
export function rawCellOf(cell: WorkbookCell | undefined, formatting: FormattingAsData = {}): RawCell {
  if (cell === undefined) return null;
  const extras: Record<string, RawScalar> = {};
  if (formatting.strike && cell.strike) extras.strike = true;
  if (formatting.fill && cell.fillSource !== null) {
    extras.fill = cell.fill;
    extras.fillSource = cell.fillSource;
  }
  if (formatting.font && cell.bold) extras.bold = true;
  if (formatting.font && cell.italic) extras.italic = true;
  if (formatting.hidden && cell.hiddenRow) extras.hiddenRow = true;
  if (formatting.hidden && cell.hiddenColumn) extras.hiddenColumn = true;
  if (formatting.merge && cell.merge !== null) extras.merge = cell.merge;
  const holdsNothing = cell.type === "empty" && cell.formula === null && cell.hyperlink === null;
  if (holdsNothing && Object.keys(extras).length === 0) return null;
  return {
    v: cell.value,
    t: cell.type,
    ...(cell.formula === null ? {} : { f: cell.formula }),
    ...(cell.hyperlink === null ? {} : { l: cell.hyperlink }),
    ...(cell.type === "number" && isDateFormat(cell.numberFormat) ? { z: cell.numberFormat } : {}),
    ...extras,
  };
}

/** Whether the record of a cell holds a value, a formula or a link, as opposed to formatting alone. */
export function holdsContent(cell: RawCell): boolean {
  if (cell === null) return false;
  if (typeof cell !== "object") return true;
  return (cell.v ?? null) !== null || cell.f !== undefined || cell.l !== undefined;
}
