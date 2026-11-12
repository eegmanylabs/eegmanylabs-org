// The form of the path of a copy on its server. The paths are synthetic.
import { describe, expect, it } from "vitest";
import { storagePathSchema } from "../callables";
import { storageAllowedPrefixesSchema, storageSecretNameSchema } from "../schemas/datasets";
import {
  hasControlCharacter,
  normaliseStoragePath,
  storagePathProblem,
  storagePathsOverlap,
  storagePathWithin,
} from "./paths";

describe("the path of a copy", () => {
  it("is stored in one normal form, so that two spellings of a folder compare equal", () => {
    expect(normaliseStoragePath("DemoAlpha2001/attention-main/")).toBe("DemoAlpha2001/attention-main");
    expect(normaliseStoragePath("DemoAlpha2001//attention-main")).toBe("DemoAlpha2001/attention-main");
    expect(normaliseStoragePath("DemoAlpha2001/attention-main")).toBe("DemoAlpha2001/attention-main");
  });

  it("refuses a path that names the whole server, leaves its folder or starts at the root", () => {
    for (const path of ["", ".", "./", "/", "..", "DemoAlpha2001/../other", "a/./b", "/eeg/DemoAlpha2001"]) {
      expect(storagePathProblem(path), path).not.toBeNull();
      expect(normaliseStoragePath(path), path).toBeNull();
    }
  });

  it("refuses every control character, which a batch of commands would read as the end of a command", () => {
    for (const path of ["DemoAlpha2001\n!true", "a\rb", "a\tb", "a\u0000b", "a\u007fb"]) {
      expect(hasControlCharacter(path)).toBe(true);
      expect(storagePathSchema.safeParse(path).success, JSON.stringify(path)).toBe(false);
    }
    expect(storagePathSchema.safeParse("DemoAlpha2001/attention-main").success).toBe(true);
  });

  it("lies within a folder only at a boundary between segments", () => {
    expect(storagePathWithin("DemoAlpha2001/attention-main", "DemoAlpha2001")).toBe(true);
    expect(storagePathWithin("DemoAlpha2001", "DemoAlpha2001")).toBe(true);
    expect(storagePathWithin("DemoAlpha2001-other/x", "DemoAlpha2001")).toBe(false);
    expect(storagePathsOverlap("DemoAlpha2001", "DemoAlpha2001/attention-main")).toBe(true);
    expect(storagePathsOverlap("DemoAlpha2001/signal-main", "DemoAlpha2001/attention-main")).toBe(false);
  });
});

describe("the connection of a server", () => {
  it("names only a storage secret, never another setting of the functions", () => {
    expect(storageSecretNameSchema.safeParse("STORAGE_BREMEN_READONLY").success).toBe(true);
    expect(storageSecretNameSchema.safeParse("GOOGLE_WORKSPACE_SERVICE_ACCOUNT").success).toBe(false);
    expect(storageSecretNameSchema.safeParse("STORAGE_").success).toBe(false);
  });

  it("keeps a folder in normal form for each replication or laboratory, and nothing else", () => {
    expect(storageAllowedPrefixesSchema.safeParse({ "rep:DemoAlpha2001": "DemoAlpha2001" }).success).toBe(true);
    expect(storageAllowedPrefixesSchema.safeParse({ "lab:demo-lab": "DemoAlpha2001/attention-main" }).success).toBe(
      true,
    );
    expect(storageAllowedPrefixesSchema.safeParse({ members: "DemoAlpha2001" }).success).toBe(false);
    expect(storageAllowedPrefixesSchema.safeParse({ "rep:DemoAlpha2001": "DemoAlpha2001/" }).success).toBe(false);
    expect(storageAllowedPrefixesSchema.safeParse({ "rep:DemoAlpha2001": "." }).success).toBe(false);
  });
});
