// The pieces of the presence of a page that need no Firestore (see page-presence.ts): the wire
// format of y-protocols for one state, and the names of the others an awareness holds.
import type { Awareness } from "y-protocols/awareness";

function writeVarUint(out: number[], value: number): void {
  let rest = value;
  while (rest > 0x7f) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
}

/**
 * One state in the wire format of y-protocols, which `applyAwarenessUpdate` reads: the number
 * of states, then for each its client, its clock and its JSON as a string of UTF-8 bytes.
 */
export function awarenessUpdateOf(clientId: number, clock: number, state: string): Uint8Array {
  const out: number[] = [];
  writeVarUint(out, 1);
  writeVarUint(out, clientId);
  writeVarUint(out, clock);
  const bytes = new TextEncoder().encode(state);
  writeVarUint(out, bytes.length);
  out.push(...bytes);
  return Uint8Array.from(out);
}

/** The names of the others whose state an awareness holds, each once, in order. */
export function namesOfOthers(awareness: Awareness): string[] {
  const names = new Set<string>();
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue;
    const user = (state as { user?: { name?: unknown } }).user;
    if (typeof user?.name === "string" && user.name.trim() !== "") names.add(user.name.trim());
  }
  return [...names].sort((a, b) => a.localeCompare(b, "en-GB"));
}
