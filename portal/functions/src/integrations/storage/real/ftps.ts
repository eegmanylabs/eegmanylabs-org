// UNVERIFIED. Written from RFC 959, RFC 3659 (MLSD) and RFC 4217 (FTP over TLS) and never run:
// no FTPS account exists (docs/INTEGRATIONS.md, section 7). Nothing in the emulator or in any
// test reaches it.
//
// Explicit FTPS over the TLS module of Node.js: the control connection is upgraded with
// `AUTH TLS`, the data connections are protected with `PROT P` and resume the session of the
// control connection, which many servers require. A page of a listing is `MLSD` of one
// directory, whose cursor is the queue of directories still to list, and a checksum file is read
// with `RETR`. The secret holds `host`, `username` and `password` of a read-only account. Certificates
// are always verified.
import net from "node:net";
import tls from "node:tls";
import { type ListedFile, type StorageAdapter, StorageError, type StorageTarget } from "../types";
import { credentialOf, remotePath } from "./credentials";

interface Reply {
  readonly code: number;
  readonly text: string;
}

/** The control connection: one reply at a time, in the order the commands were sent. */
class Control {
  private buffer = "";
  private waiting: ((reply: Reply) => void)[] = [];
  private replies: Reply[] = [];

  constructor(public socket: net.Socket | tls.TLSSocket) {
    this.listen(socket);
  }

  listen(socket: net.Socket | tls.TLSSocket): void {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      // A reply ends with a line that starts with three digits and a space.
      for (;;) {
        const match = /(^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(this.buffer);
        if (match === null) break;
        const end = match.index + match[0].length;
        const reply = { code: Number(match[2]), text: this.buffer.slice(0, end) };
        this.buffer = this.buffer.slice(end);
        const next = this.waiting.shift();
        if (next === undefined) this.replies.push(reply);
        else next(reply);
      }
    });
  }

  read(): Promise<Reply> {
    const ready = this.replies.shift();
    return ready === undefined ? new Promise((resolve) => this.waiting.push(resolve)) : Promise.resolve(ready);
  }

  async send(command: string, expected: readonly number[]): Promise<Reply> {
    this.socket.write(`${command}\r\n`);
    const reply = await this.read();
    if (!expected.includes(reply.code)) {
      if (reply.code === 530 || reply.code === 550) {
        throw new StorageError(reply.code === 530 ? "permissionDenied" : "notFound", "The server refused the request.");
      }
      throw new StorageError("failed", `The server answered ${reply.code}.`);
    }
    return reply;
  }
}

async function open(target: StorageTarget): Promise<Control> {
  const secret = credentialOf(target, ["username", "password"]);
  const plain = await new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect({ host: target.host, port: target.port ?? 21 }, () => resolve(socket));
    socket.once("error", () => reject(new StorageError("unreachable", "The server did not answer.")));
  });
  const control = new Control(plain);
  if ((await control.read()).code !== 220) throw new StorageError("failed", "The server did not greet the portal.");
  await control.send("AUTH TLS", [234]);
  plain.removeAllListeners("data");
  const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const socket = tls.connect({ socket: plain, servername: target.host }, () => resolve(socket));
    socket.once("error", () => reject(new StorageError("failed", "The TLS handshake with the server failed.")));
  });
  control.listen(secure);
  await control.send(`USER ${secret.username}`, [331, 230]);
  await control.send(`PASS ${secret.password}`, [230, 202]);
  await control.send("PBSZ 0", [200]);
  await control.send("PROT P", [200]);
  await control.send("TYPE I", [200]);
  return control;
}

/** Runs one transfer over a protected data connection and gives what it carried. */
async function transfer(control: Control, target: StorageTarget, command: string): Promise<string> {
  const passive = await control.send("EPSV", [229]);
  const port = Number(/\(\|\|\|(\d+)\|\)/.exec(passive.text)?.[1] ?? Number.NaN);
  if (!Number.isInteger(port)) throw new StorageError("failed", "The server gave no port for the data connection.");
  const control_ = control.socket;
  const session = control_ instanceof tls.TLSSocket ? control_.getSession() : undefined;
  const data = tls.connect({
    host: target.host,
    port,
    servername: target.host,
    ...(session === undefined ? {} : { session }),
  });
  const received = new Promise<string>((resolve, reject) => {
    let text = "";
    data.setEncoding("utf8");
    data.on("data", (chunk: string) => {
      text += chunk;
    });
    data.once("end", () => resolve(text));
    data.once("error", () => reject(new StorageError("failed", "The data connection failed.")));
  });
  await control.send(command, [125, 150]);
  const text = await received;
  await control.read();
  return text;
}

async function withControl<T>(target: StorageTarget, work: (control: Control) => Promise<T>): Promise<T> {
  const control = await open(target);
  try {
    return await work(control);
  } finally {
    control.socket.end("QUIT\r\n");
  }
}

/** One line of MLSD: facts separated by semicolons, a space, and the name. */
function parseMlsd(line: string): { name: string; type: string; size: number; modified: string | null } | null {
  const space = line.indexOf(" ");
  if (space === -1) return null;
  const facts = new Map(
    line
      .slice(0, space)
      .split(";")
      .filter((fact) => fact.includes("="))
      .map((fact) => [fact.slice(0, fact.indexOf("=")).toLowerCase(), fact.slice(fact.indexOf("=") + 1)] as const),
  );
  const modify = facts.get("modify");
  const modified =
    modify !== undefined && /^\d{14}/.test(modify)
      ? `${modify.slice(0, 4)}-${modify.slice(4, 6)}-${modify.slice(6, 8)}T${modify.slice(8, 10)}:${modify.slice(10, 12)}:${modify.slice(12, 14)}Z`
      : null;
  return {
    name: line.slice(space + 1),
    type: (facts.get("type") ?? "").toLowerCase(),
    size: Number(facts.get("size") ?? 0),
    modified,
  };
}

export const ftpsAdapter: StorageAdapter = {
  check: (target) =>
    withControl(target, async (control) => {
      await control.send("NOOP", [200]);
      return "The FTPS server answered.";
    }),
  list: (target, cursor) =>
    withControl(target, async (control) => {
      const queue: string[] = cursor === null ? [""] : (JSON.parse(cursor) as string[]);
      const directory = queue.shift() ?? "";
      const text = await transfer(control, target, `MLSD ${remotePath(target, directory)}`);
      const files: ListedFile[] = [];
      for (const line of text.split(/\r?\n/)) {
        const entry = parseMlsd(line.trim());
        if (entry === null) continue;
        const relativePath = directory === "" ? entry.name : `${directory}/${entry.name}`;
        if (entry.type === "dir") queue.push(relativePath);
        else if (entry.type === "file") files.push({ relativePath, sizeBytes: entry.size, modifiedAt: entry.modified });
      }
      return { files, nextCursor: queue.length === 0 ? null : JSON.stringify(queue) };
    }),
  readText: (target, relativePath, maxBytes) =>
    withControl(target, async (control) => {
      const text = await transfer(control, target, `RETR ${remotePath(target, relativePath)}`);
      if (text.length > maxBytes) throw new StorageError("failed", "The file is larger than a checksum file may be.");
      return text;
    }),
};
