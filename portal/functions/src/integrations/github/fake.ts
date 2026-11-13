// The fake of the website repository. It holds a small history of commits, branches and pull
// requests, and reproduces what docs/INTEGRATIONS.md, section 6, relies on: a branch that moved
// since the portal read it (a stale revision), a branch name that is taken, a credential that is
// refused (lost access), a rate limit that asks the portal to wait, and an outage. A test acts as
// the maintainers do: it merges or closes a pull request and pushes to the main branch.
//
// Its main branch starts from the committed data files of this repository, which it reads from
// the checkout named by `EEGML_WEBSITE_ROOT` and never changes, so a preview compares the portal
// with the files that are really on the website. Without that variable it starts from three
// synthetic lines. Its state lives in memory for unit tests and in a file of the emulator run
// otherwise, so the functions of the emulator and a browser test share it.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type FakeStore, FileStore, MemoryStore } from "../google/fake/store";
import {
  type CommitFile,
  GitHubError,
  MAIN_BRANCH,
  type PullRequest,
  type PullRequestState,
  type WebsiteRepository,
} from "./types";

interface FakeCommit {
  parent: string | null;
  message: string;
  files: Record<string, string>;
}

interface FakePull {
  number: number;
  head: string;
  base: string;
  /** The commit of the base branch the head was compared with when it was opened. */
  baseSha: string;
  title: string;
  body: string;
  state: PullRequestState;
  mergeCommitSha: string | null;
}

export interface GitHubFakeState {
  schema: 1;
  mode: "up" | "down";
  /** Whether the credential is refused, as after it was revoked. */
  accessLost: boolean;
  rateLimitedRequests: number;
  retryAfterSeconds: number;
  commits: Record<string, FakeCommit>;
  branches: Record<string, string>;
  pulls: FakePull[];
  /** Every operation asked for, so a test can prove what the portal did and that it never merged. */
  operations: string[];
}

/**
 * The repository of the fake, under a host that can never resolve (RFC 2606 reserves `.invalid`),
 * so a link to one of its pull requests opens no real page and is never mistaken for GitHub.
 */
export const FAKE_REPOSITORY = "fake/website";
export const FAKE_GITHUB_ORIGIN = "https://github.example.invalid";

/** The data files of the public site the fake starts from. */
const WEBSITE_DATA_FILES = ["data/replications.tsv", "data/publications.tsv", "data/people.tsv", "data/members.tsv"];

/** Synthetic files for a fake without a checkout: invented rows that say what they are. */
const SYNTHETIC_FILES: Record<string, string> = {
  "data/replications.tsv": "StudyId\tTheme\nSynthetic2001\tAttention",
  "data/publications.tsv": "PublicationId\tTitle\r\nSyntheticPublication\tA synthetic title",
  "data/people.tsv": "PersonId\tFullName\r\nsynthetic-core\tSynthetic Core\n",
  "data/members.tsv":
    "SequenceNumber\tPersonId\tFullName\tAffiliation\tCountry\n1\tsynthetic-member\tSynthetic Member\tSynthetic Institute\tNowhere\n",
};

function shaOf(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

function committedFiles(): Record<string, string> {
  const root = process.env.EEGML_WEBSITE_ROOT;
  if (root === undefined || root === "") return { ...SYNTHETIC_FILES };
  const files: Record<string, string> = {};
  for (const file of WEBSITE_DATA_FILES) files[file] = readFileSync(path.join(root, file), "utf8");
  return files;
}

export function initialGitHubState(): GitHubFakeState {
  const root: FakeCommit = { parent: null, message: "The website as committed", files: committedFiles() };
  const sha = shaOf(root);
  return {
    schema: 1,
    mode: "up",
    accessLost: false,
    rateLimitedRequests: 0,
    retryAfterSeconds: 1,
    commits: { [sha]: root },
    branches: { [MAIN_BRANCH]: sha },
    pulls: [],
    operations: [],
  };
}

function headOf(state: GitHubFakeState, branch: string): string {
  const sha = state.branches[branch];
  if (sha === undefined) throw new GitHubError("notFound", `No branch ${branch}.`);
  return sha;
}

function commitOf(state: GitHubFakeState, sha: string): FakeCommit {
  const commit = state.commits[sha];
  if (commit === undefined) throw new GitHubError("notFound", `No commit ${sha}.`);
  return commit;
}

function asPullRequest(pull: FakePull): PullRequest {
  return {
    number: pull.number,
    url: `${FAKE_GITHUB_ORIGIN}/${FAKE_REPOSITORY}/pull/${pull.number}`,
    state: pull.state,
    headBranch: pull.head,
    baseBranch: pull.base,
    title: pull.title,
    mergeCommitSha: pull.mergeCommitSha,
  };
}

function addCommit(state: GitHubFakeState, parent: string, files: Record<string, string>, message: string): string {
  const commit: FakeCommit = { parent, message, files };
  const sha = shaOf({ ...commit, at: Object.keys(state.commits).length });
  state.commits[sha] = commit;
  return sha;
}

export class GitHubFake {
  constructor(private readonly store: FakeStore<GitHubFakeState>) {}

  transact<T>(change: (state: GitHubFakeState) => T): T {
    return this.store.transact(change);
  }

  setMode(mode: GitHubFakeState["mode"]): void {
    this.transact((state) => {
      state.mode = mode;
    });
  }

  setAccessLost(lost: boolean): void {
    this.transact((state) => {
      state.accessLost = lost;
    });
  }

  limitRate(requests: number, retryAfterSeconds = 1): void {
    this.transact((state) => {
      state.rateLimitedRequests = requests;
      state.retryAfterSeconds = retryAfterSeconds;
    });
  }

  operations(): string[] {
    return this.transact((state) => [...state.operations]);
  }

  /** The files of a branch, as the maintainers would see them. */
  filesOf(branch: string): Record<string, string> {
    return this.transact((state) => ({ ...commitOf(state, headOf(state, branch)).files }));
  }

  pulls(): PullRequest[] {
    return this.transact((state) => state.pulls.map(asPullRequest));
  }

  /** The description of a pull request, as a reviewer reads it. */
  pullBody(number: number): string {
    return this.transact((state) => state.pulls.find((pull) => pull.number === number)?.body ?? "");
  }

  /** A maintainer pushes a change to the main branch, which makes every older reading of it stale. */
  pushToMain(files: Record<string, string>, message = "A maintainer's change"): string {
    return this.transact((state) => {
      const head = headOf(state, MAIN_BRANCH);
      const sha = addCommit(state, head, { ...commitOf(state, head).files, ...files }, message);
      state.branches[MAIN_BRANCH] = sha;
      return sha;
    });
  }

  /** A maintainer merges a pull request: what its branch changed is applied to the main branch. */
  merge(number: number): string {
    return this.transact((state) => {
      const pull = state.pulls.find((candidate) => candidate.number === number);
      if (pull === undefined || pull.state !== "open") throw new Error(`Pull request ${number} is not open.`);
      const base = commitOf(state, pull.baseSha).files;
      const head = commitOf(state, headOf(state, pull.head)).files;
      const mainHead = headOf(state, pull.base);
      const merged = { ...commitOf(state, mainHead).files };
      for (const [file, text] of Object.entries(head)) if (base[file] !== text) merged[file] = text;
      for (const file of Object.keys(base)) if (!(file in head)) delete merged[file];
      const sha = addCommit(state, mainHead, merged, `Merge pull request #${number}`);
      state.branches[pull.base] = sha;
      pull.state = "merged";
      pull.mergeCommitSha = sha;
      return sha;
    });
  }

  /** A maintainer closes a pull request without merging it. */
  close(number: number): void {
    this.transact((state) => {
      const pull = state.pulls.find((candidate) => candidate.number === number);
      if (pull !== undefined && pull.state === "open") pull.state = "closed";
    });
  }

  repository(): WebsiteRepository {
    /** Runs one request: the faults are decided first, and the request is recorded whatever it answers. */
    const request = async <T>(operation: string, act: (state: GitHubFakeState) => T): Promise<T> => {
      const answer = this.transact((state): { value: T } | { error: GitHubError } => {
        state.operations.push(operation);
        if (state.mode === "down") return { error: new GitHubError("unavailable", "GitHub answered with an error.") };
        if (state.accessLost) return { error: new GitHubError("accessLost", "GitHub refused the credential.") };
        if (state.rateLimitedRequests > 0) {
          state.rateLimitedRequests -= 1;
          return {
            error: new GitHubError("rateLimited", "GitHub asked the portal to wait.", state.retryAfterSeconds),
          };
        }
        try {
          return { value: act(state) };
        } catch (error) {
          if (error instanceof GitHubError) return { error };
          throw error;
        }
      });
      if ("error" in answer) throw answer.error;
      return answer.value;
    };
    return {
      name: FAKE_REPOSITORY,
      branchHead: (branch) => request(`branchHead ${branch}`, (state) => headOf(state, branch)),
      readFile: (file, commit) => request(`readFile ${file}`, (state) => commitOf(state, commit).files[file] ?? null),
      createBranch: (branch, commit) =>
        request(`createBranch ${branch}`, (state) => {
          if (state.branches[branch] !== undefined) throw new GitHubError("conflict", `The branch ${branch} exists.`);
          commitOf(state, commit);
          state.branches[branch] = commit;
        }),
      commitFiles: (branch, expectedHead, files: readonly CommitFile[], message) =>
        request(`commitFiles ${branch}`, (state) => {
          const head = headOf(state, branch);
          if (head !== expectedHead) throw new GitHubError("staleBase", `The branch ${branch} moved.`);
          const next = { ...commitOf(state, head).files };
          for (const file of files) {
            if (file.content === null) delete next[file.path];
            else next[file.path] = file.content;
          }
          const sha = addCommit(state, head, next, message);
          state.branches[branch] = sha;
          return sha;
        }),
      openPullRequest: ({ head, base, title, body }) =>
        request(`openPullRequest ${head}`, (state) => {
          headOf(state, head);
          const pull: FakePull = {
            number: state.pulls.length + 1,
            head,
            base,
            baseSha: headOf(state, base),
            title,
            body,
            state: "open",
            mergeCommitSha: null,
          };
          state.pulls.push(pull);
          return asPullRequest(pull);
        }),
      pullRequest: (number) =>
        request(`pullRequest ${number}`, (state) => {
          const pull = state.pulls.find((candidate) => candidate.number === number);
          if (pull === undefined) throw new GitHubError("notFound", `No pull request ${number}.`);
          return asPullRequest(pull);
        }),
      openPullRequests: (prefix) =>
        request(`openPullRequests ${prefix}`, (state) =>
          state.pulls.filter((pull) => pull.state === "open" && pull.head.startsWith(prefix)).map(asPullRequest),
        ),
      closePullRequest: (number) =>
        request(`closePullRequest ${number}`, (state) => {
          const pull = state.pulls.find((candidate) => candidate.number === number);
          if (pull === undefined) throw new GitHubError("notFound", `No pull request ${number}.`);
          if (pull.state === "open") pull.state = "closed";
        }),
    };
  }
}

/** A fake in memory, for unit tests. */
export function memoryGitHubFake(): GitHubFake {
  return new GitHubFake(new MemoryStore(initialGitHubState()));
}

/** The file that holds the fake's state in an emulator run, in the run's own temporary directory. */
export function gitHubFakeStatePath(): string {
  return path.join(os.tmpdir(), "eegml-github-fake", "state.json");
}

/** The fake of an emulator run, over the run's state file. */
export function emulatorGitHubFake(): GitHubFake {
  return new GitHubFake(new FileStore(gitHubFakeStatePath(), initialGitHubState));
}
