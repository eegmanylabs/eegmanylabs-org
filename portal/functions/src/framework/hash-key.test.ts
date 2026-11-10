import { DEMO_IDENTITY_HASH_KEY, MIN_HASH_SECRET_BYTES } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { identityHashKey } from "./hash-key";

describe("the key of the keyed hashes", () => {
  const key = "a-synthetic-key-that-is-long-enough-for-a-keyed-hash";

  it("is the secret of the environment where one is bound", () => {
    expect(identityHashKey({ IDENTITY_HASH_KEY: key })).toBe(key);
    expect(identityHashKey({ IDENTITY_HASH_KEY: ` ${key}\n`, FUNCTIONS_EMULATOR: "true" })).toBe(key);
  });

  it("is the public demonstration key in the emulator, and there alone", () => {
    expect(identityHashKey({ FUNCTIONS_EMULATOR: "true" })).toBe(DEMO_IDENTITY_HASH_KEY);
    expect(Buffer.byteLength(DEMO_IDENTITY_HASH_KEY, "utf8")).toBeGreaterThanOrEqual(MIN_HASH_SECRET_BYTES);
    expect(() => identityHashKey({})).toThrow(/IDENTITY_HASH_KEY is not available/);
    expect(() => identityHashKey({ FUNCTIONS_EMULATOR: "false" })).toThrow();
    expect(() => identityHashKey({ IDENTITY_HASH_KEY: "  " })).toThrow();
  });

  it("refuses a secret that is too short to protect anything, and never repeats it", () => {
    const short = "short-secret";
    expect(() => identityHashKey({ IDENTITY_HASH_KEY: short })).toThrow(/shorter than 32 bytes/);
    try {
      identityHashKey({ IDENTITY_HASH_KEY: short });
    } catch (error) {
      expect(String(error)).not.toContain(short);
    }
  });
});
