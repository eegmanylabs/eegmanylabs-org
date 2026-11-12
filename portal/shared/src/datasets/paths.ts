// The path of a copy of a dataset on its storage server (docs/DATA_MODEL.md, section 10). A path
// is relative to the base path of the server, and the functions store it in one normal form, so
// that two spellings of one directory compare equal: segments joined by single slashes, with no
// slash at either end. A path that could leave the base path, name the whole server, or carry a
// character that an adapter's command line would read as the end of a command is refused.

/**
 * Whether a text holds a control character (U+0000 to U+001F, or U+007F), such as a line break
 * or a tab, which no path may hold: a line break would start a new command in a batch.
 */
export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Why a path of a copy is refused, in words for the person who typed it, or null when it is
 * acceptable.
 */
export function storagePathProblem(path: string): string | null {
  if (hasControlCharacter(path)) return "A path may not hold a line break, a tab or another control character.";
  if (path.startsWith("/")) return "A path is relative to the server's base path, so it does not start with a slash.";
  const segments = path.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return "Give the folder of the copy below the server's base path.";
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return "A path may not hold the segments . or .., which would leave its folder.";
  }
  return null;
}

/**
 * The normal form of a path of a copy: its segments joined by single slashes, with no slash at
 * either end. Null for a path that `storagePathProblem` refuses.
 */
export function normaliseStoragePath(path: string): string | null {
  if (storagePathProblem(path) !== null) return null;
  return path
    .split("/")
    .filter((segment) => segment !== "")
    .join("/");
}

/** Whether a normalised path is a folder or the same folder as another normalised path. */
export function storagePathWithin(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** Whether two normalised paths name the same folder, or one lies inside the other. */
export function storagePathsOverlap(a: string, b: string): boolean {
  return storagePathWithin(a, b) || storagePathWithin(b, a);
}
