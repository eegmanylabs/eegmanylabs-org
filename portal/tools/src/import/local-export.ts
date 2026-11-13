// Sources that arrive as exported files which an administrator supplies (docs/DECISIONS.md,
// answers of 13 November 2026, decision 7): the historical coordination workbook (A), the
// membership workbook (G) and the Quire data. Such a file holds restricted rows, so it is read
// only from outside the repository, where nothing that git could commit lies beside it, and
// whatever the importer writes beside its input stays outside the repository as well. Nothing it
// reads reaches a message: the importers print counts, identifiers and paths of documents only.
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { ToolRefusal } from "../environment";
import { PORTAL_DIRECTORY } from "./config";

/** The directory of the repository that holds the portal: the nearest ancestor with a `.git` entry. */
export function repositoryDirectory(start: string = PORTAL_DIRECTORY): string {
  let directory = path.resolve(start);
  while (!existsSync(path.join(directory, ".git"))) {
    const parent = path.dirname(directory);
    if (parent === directory) return path.resolve(start);
    directory = parent;
  }
  return directory;
}

/** Whether a path lies inside a directory, the directory itself included, after symbolic links are resolved. */
export function liesWithin(candidate: string, directory: string): boolean {
  const real = (target: string) => (existsSync(target) ? realpathSync(target) : path.resolve(target));
  const relative = path.relative(real(directory), real(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Whether git would offer a file at this path for a commit: the path lies in a git work tree,
 * whichever repository that is, and git does not ignore it. Both questions only read.
 */
export function committableAt(filePath: string): boolean {
  const target = path.resolve(filePath);
  let directory = path.dirname(target);
  while (!existsSync(directory) && path.dirname(directory) !== directory) directory = path.dirname(directory);
  const real = realpathSync(directory);
  // A directory that does not exist yet is judged by its path beneath the nearest one that does.
  const asSeenByGit = path.join(real, path.relative(directory, target));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", real, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    if (git("rev-parse", "--is-inside-work-tree") !== "true") return false;
  } catch {
    return false;
  }
  try {
    // `check-ignore` ends with status 0 for an ignored path and with status 1 for one that is not.
    git("check-ignore", "--quiet", asSeenByGit);
    return false;
  } catch {
    return true;
  }
}

/** The files that an import writes beside its input: the report of the input, as data and as text. */
export function filesBeside(inputPath: string): readonly string[] {
  return [`${inputPath}.report.json`, `${inputPath}.report.txt`];
}

/**
 * Refuses an export of a local source that lies inside the repository of the portal, or anywhere
 * git would commit it or what the import writes beside it: in any work tree, another clone or a
 * future repository of the portal included, unless git ignores it. The refusal names the source
 * and no part of the file.
 */
export function requireOutsideRepository(
  sourceKey: string,
  inputPath: string,
  repository: string = repositoryDirectory(),
): void {
  if (liesWithin(inputPath, repository)) {
    throw new ToolRefusal(
      `Refusing to read source ${sourceKey}: its export lies inside the repository, where it could be committed. ` +
        "Keep the exported file in a private directory outside the repository and name that path with --input.",
    );
  }
  if ([inputPath, ...filesBeside(inputPath)].some(committableAt)) {
    throw new ToolRefusal(
      `Refusing to read source ${sourceKey}: its export, or the report written beside it, lies in a git work tree ` +
        "that does not ignore it, where it could be committed. Keep the exported file in a private directory outside " +
        "every repository, or in one that git ignores, and name that path with --input.",
    );
  }
}
