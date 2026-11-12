// The two pure helpers that every real storage adapter uses before it reaches a server: the path
// it sends and the credential it sends with it. No server is contacted. The secrets, hosts and
// paths are synthetic, on the example.org domain.
import { afterEach, describe, expect, it } from "vitest";
import { StorageError, type StorageTarget } from "../types";
import { credentialOf, remotePath } from "./credentials";

const target: StorageTarget = {
  protocol: "ftps",
  host: "ftps.munich.example.org",
  port: null,
  basePath: "projects/eegmanylabs",
  path: "DemoAlpha2001/signal-main",
  credentialRef: "STORAGE_SYNTHETIC_TEST",
};

const SECRET = { username: "synthetic", password: "not-a-real-password", host: "ftps.munich.example.org" };

afterEach(() => {
  delete process.env.STORAGE_SYNTHETIC_TEST;
  delete process.env.SYNTHETIC_OTHER_SETTING;
});

describe("remotePath", () => {
  it("joins the base path and the path of the copy with single slashes", () => {
    expect(remotePath(target, "sub-01/")).toBe("/projects/eegmanylabs/DemoAlpha2001/signal-main/sub-01");
  });

  it("refuses a control character and a segment that leaves the base path", () => {
    expect(() => remotePath({ ...target, path: "DemoAlpha2001\n!true" })).toThrow(StorageError);
    expect(() => remotePath(target, "sub-01\r\nDELE x")).toThrow(StorageError);
    expect(() => remotePath({ ...target, path: "../other" })).toThrow(StorageError);
  });
});

describe("credentialOf", () => {
  it("gives the credential only for the host and base path its secret names", () => {
    process.env.STORAGE_SYNTHETIC_TEST = JSON.stringify(SECRET);
    expect(credentialOf(target, ["username", "password"]).username).toBe("synthetic");
    expect(() => credentialOf({ ...target, host: "collector.example.org" }, ["username", "password"])).toThrow(
      "another host",
    );
    process.env.STORAGE_SYNTHETIC_TEST = JSON.stringify({ ...SECRET, basePath: "projects/eegmanylabs/" });
    expect(credentialOf(target, ["username", "password"]).password).toBe("not-a-real-password");
    expect(() => credentialOf({ ...target, basePath: "projects" }, ["username", "password"])).toThrow(
      "another base path",
    );
  });

  it("refuses a secret that does not name its host, and a name that is no storage secret", () => {
    process.env.STORAGE_SYNTHETIC_TEST = JSON.stringify({ username: "synthetic", password: "x" });
    expect(() => credentialOf(target, ["username", "password"])).toThrow("lacks the field host");
    process.env.SYNTHETIC_OTHER_SETTING = JSON.stringify(SECRET);
    expect(() => credentialOf({ ...target, credentialRef: "SYNTHETIC_OTHER_SETTING" }, ["username"])).toThrow(
      "not a storage secret",
    );
  });
});
