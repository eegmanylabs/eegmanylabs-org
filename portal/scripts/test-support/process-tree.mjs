#!/usr/bin/env node
// @ts-check
// A process tree for the tests of process-group.mjs: this process and one child that it starts.
// Both write nothing and wait. The identifiers of both, and the port the child listens on, are
// written to the file named by the first argument.
//
//   STUBBORN=1       both processes ignore the interrupt and the termination signal
//   LEAVE_ORPHAN=7   this process ends with status 7 as soon as the file is written
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";

const [reportFile, role] = process.argv.slice(2);

if (process.env.STUBBORN === "1") {
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => {});
}

if (role === "child") {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    process.send?.({ port: typeof address === "object" && address ? address.port : 0 });
  });
} else {
  if (!reportFile) throw new Error("process-tree.mjs needs the path of its report file.");
  const child = spawn(process.execPath, [import.meta.filename, reportFile, "child"], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  child.on("message", (message) => {
    const { port } = /** @type {{ port: number }} */ (message);
    writeFileSync(reportFile, JSON.stringify({ parent: process.pid, child: child.pid, port }));
    // Without the channel the child no longer depends on this process in any way.
    child.disconnect();
    child.unref();
    if (process.env.LEAVE_ORPHAN) process.exit(Number(process.env.LEAVE_ORPHAN));
  });
  setInterval(() => {}, 1_000);
}
