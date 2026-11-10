// Small wrappers around browser storage that never throw. Storage can be unavailable (private
// browsing, a full quota, a blocked origin), and nothing the portal keeps there is essential.
//
// | Store     | Lives                                   | Seen by                    |
// |-----------|-----------------------------------------|----------------------------|
// | `local`   | Until it is removed                     | Every tab of the portal    |
// | `session` | Until the tab is closed, across reloads | The tab that wrote it only |

export type StoreName = "local" | "session";

function store(name: StoreName): Storage {
  return name === "local" ? window.localStorage : window.sessionStorage;
}

export function readStored(key: string, from: StoreName = "local"): string | null {
  try {
    return store(from).getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null, to: StoreName = "local"): void {
  try {
    if (value === null) store(to).removeItem(key);
    else store(to).setItem(key, value);
  } catch {
    // Nothing to do: the value is a convenience.
  }
}
