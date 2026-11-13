// The guard script of web/public, run in a sandbox with a stand-in for the browser window.
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(path.join(import.meta.dirname, "..", "public", "frame-guard.js"), "utf8");

function run(address: string, framed = false) {
  const url = new URL(address);
  const replaced: string[] = [];
  const attributes = new Map<string, string>();
  const location = {
    protocol: url.protocol,
    hostname: url.hostname,
    host: url.host,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    href: url.href,
    replace: (target: string) => replaced.push(target),
  };
  const self = { location };
  const top = framed ? { location: { replace: (target: string) => replaced.push(`top:${target}`) } } : self;
  runInNewContext(SOURCE, {
    window: { location, self, top },
    document: { documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) } },
  });
  return { replaced, framed: attributes.get("data-framed") === "true" };
}

describe("the guard script", () => {
  it("sends a plain HTTP address to HTTPS and keeps the application from starting", () => {
    expect(run("http://portal.example.org/#/replications?x=1")).toEqual({
      replaced: ["https://portal.example.org/#/replications?x=1"],
      framed: true,
    });
  });

  it("leaves HTTPS alone, and plain HTTP on this machine for the emulators", () => {
    expect(run("https://portal.example.org/#/")).toEqual({ replaced: [], framed: false });
    expect(run("http://127.0.0.1:9350/portal/#/")).toEqual({ replaced: [], framed: false });
    expect(run("http://localhost:9351/")).toEqual({ replaced: [], framed: false });
  });

  it("breaks out of a frame", () => {
    expect(run("https://portal.example.org/#/", true)).toEqual({
      replaced: ["top:https://portal.example.org/#/"],
      framed: true,
    });
  });
});
