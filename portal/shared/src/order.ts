// Fractional order keys: a sibling is placed between two others by writing its own document
// alone (docs/DATA_MODEL.md, section 9). A key is a text of the digits `0` to `9` and the
// letters `a` to `z`, compared as text, and never ends in `0`, so that there is always room
// before it.

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

/** The longest order key. The schemas and the rules accept no longer one. */
export const ORDER_KEY_MAX_LENGTH = 100;

/** Whether a text is an order key. */
export function isOrderKey(key: string): boolean {
  return key.length > 0 && key.length <= ORDER_KEY_MAX_LENGTH && /^[0-9a-z]*[1-9a-z]$/.test(key);
}

function digitAt(key: string, index: number): number {
  return DIGITS.indexOf(key[index] ?? "0");
}

/**
 * A key that sorts after `before` and before `after`. Null stands for the start or the end of
 * the list. Throws when the keys are malformed or out of order.
 */
export function orderBetween(before: string | null, after: string | null): string {
  if (before !== null && !isOrderKey(before)) throw new RangeError(`"${before}" is not an order key.`);
  if (after !== null && !isOrderKey(after)) throw new RangeError(`"${after}" is not an order key.`);
  if (before !== null && after !== null && before >= after) throw new RangeError("The keys are out of order.");
  const low = before ?? "";
  let high = after;
  let key = "";
  for (let index = 0; ; index += 1) {
    const lower = index < low.length ? digitAt(low, index) : 0;
    const upper = high !== null && index < high.length ? digitAt(high, index) : BASE;
    if (lower === upper) {
      key += DIGITS[lower];
      continue;
    }
    const middle = Math.floor((lower + upper) / 2);
    if (middle > lower) return key + DIGITS[middle];
    // The two digits are neighbours. Keep the lower one: whatever follows sorts below `high`.
    key += DIGITS[lower];
    high = null;
  }
}

/** Keys for `count` items in a row after `before`, each after the one before it. */
export function orderKeysAfter(before: string | null, count: number): string[] {
  const keys: string[] = [];
  let last = before;
  for (let index = 0; index < count; index += 1) {
    last = orderBetween(last, null);
    keys.push(last);
  }
  return keys;
}
