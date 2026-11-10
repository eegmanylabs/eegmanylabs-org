// Small wrappers around localStorage that never throw. Storage can be unavailable (private
// browsing, a full quota, a blocked origin), and nothing the portal keeps there is essential.

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the value is a convenience.
  }
}
