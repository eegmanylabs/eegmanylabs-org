import { describe, expect, it } from "vitest";
import { isOrderKey, ORDER_KEY_MAX_LENGTH, orderBetween, orderKeysAfter } from "./order";

describe("orderBetween", () => {
  it("places a key between two others, after the last and before the first", () => {
    expect(orderBetween(null, null)).toBe("i");
    expect(orderBetween("i", null) > "i").toBe(true);
    expect(orderBetween(null, "i") < "i").toBe(true);
    const middle = orderBetween("a", "b");
    expect(middle > "a" && middle < "b").toBe(true);
  });

  it("finds room between neighbours and below the smallest key", () => {
    let low = "1";
    let high = "2";
    for (let round = 0; round < 60; round += 1) {
      const key = orderBetween(low, high);
      expect(isOrderKey(key)).toBe(true);
      expect(key > low && key < high).toBe(true);
      if (round % 2 === 0) low = key;
      else high = key;
    }
    let first = "1";
    for (let round = 0; round < 20; round += 1) {
      const key = orderBetween(null, first);
      expect(isOrderKey(key) && key < first).toBe(true);
      first = key;
    }
  });

  it("never ends a key in 0, so that every key has room before it", () => {
    expect(orderBetween("0z", "1")).not.toMatch(/0$/);
    expect(orderBetween(null, "01")).not.toMatch(/0$/);
  });

  it("refuses malformed and misordered keys", () => {
    expect(() => orderBetween("b", "a")).toThrow(RangeError);
    expect(() => orderBetween("a", "a")).toThrow(RangeError);
    expect(() => orderBetween("A", null)).toThrow(RangeError);
    expect(() => orderBetween("a0", null)).toThrow(RangeError);
    expect(isOrderKey("z".repeat(ORDER_KEY_MAX_LENGTH + 1))).toBe(false);
  });

  it("gives keys in a row that sort in the order they were made", () => {
    const keys = orderKeysAfter("h", 30);
    expect([...keys].sort()).toEqual(keys);
    expect((keys[0] ?? "") > "h").toBe(true);
  });
});
