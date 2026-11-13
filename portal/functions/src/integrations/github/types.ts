// The interface through which the portal proposes changes to the public website's repository
// (docs/INTEGRATIONS.md, section 6). The portal reads files, creates a branch, commits files to
// it, opens a pull request, reads the state of its pull requests and closes its own. It never
// merges and never writes to the main branch: a maintainer merges through the ordinary route.
// A fake serves every test (fake.ts); a real adapter is written against GitHub's documentation
// (real.ts), unverified and never executed.

/** A file of a commit: its new text, or null to remove it. */
export interface CommitFile {
  readonly path: string;
  readonly content: string | null;
}

export type PullRequestState = "open" | "closed" | "merged";

export interface PullRequest {
  readonly number: number;
  readonly url: string;
  readonly state: PullRequestState;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly title: string;
  /** The commit that a merge made on the main branch, once merged. */
  readonly mergeCommitSha: string | null;
}

/**
 * | Kind          | Meaning                                                                       |
 * |---------------|-------------------------------------------------------------------------------|
 * | `notFound`    | No such branch, file or pull request                                          |
 * | `conflict`    | The branch exists already                                                     |
 * | `staleBase`   | The branch moved since the portal read it: a commit would overwrite someone's work |
 * | `accessLost`  | The credential was refused or no longer reaches the repository                |
 * | `rateLimited` | GitHub asked the portal to wait. `retryAfterSeconds` says how long            |
 * | `unavailable` | GitHub did not answer, or answered with an error of its own                   |
 */
export type GitHubErrorKind = "notFound" | "conflict" | "staleBase" | "accessLost" | "rateLimited" | "unavailable";

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface WebsiteRepository {
  /** The name of the repository, as `owner/name`. */
  readonly name: string;
  /** The commit at the head of a branch. */
  branchHead(branch: string): Promise<string>;
  /** The text of a file at a commit, or null where the file does not exist there. */
  readFile(path: string, commit: string): Promise<string | null>;
  /** Creates a branch at a commit. Fails with `conflict` where the branch exists. */
  createBranch(branch: string, commit: string): Promise<void>;
  /**
   * Commits files to a branch whose head is `expectedHead`, and answers the new commit. Fails
   * with `staleBase` where the branch has moved, so nothing is ever overwritten.
   */
  commitFiles(branch: string, expectedHead: string, files: readonly CommitFile[], message: string): Promise<string>;
  openPullRequest(request: {
    readonly head: string;
    readonly base: string;
    readonly title: string;
    readonly body: string;
  }): Promise<PullRequest>;
  pullRequest(number: number): Promise<PullRequest>;
  /** The open pull requests whose branch starts with a prefix. */
  openPullRequests(headPrefix: string): Promise<readonly PullRequest[]>;
  /** Closes a pull request without merging it. */
  closePullRequest(number: number): Promise<void>;
}

/** The branch every publication targets. */
export const MAIN_BRANCH = "main";

/** The prefix of the branches the portal creates, by which it recognises its own pull requests. */
export const PORTAL_BRANCH_PREFIX = "portal/publication-";
