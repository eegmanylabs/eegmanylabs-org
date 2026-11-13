// The adapter of the real GitHub REST interface, written against GitHub's public documentation
// of the git data, contents and pull request endpoints, and UNVERIFIED: it has never been
// executed, by a test or otherwise. Every test uses the fake. It needs a credential that can push
// a new branch and open a pull request on the one repository and nothing else, which an
// organisation owner issues once `main` is confirmed to be protected (docs/INTEGRATIONS.md,
// section 6). It never merges and never writes to `main`.
import { type CommitFile, GitHubError, type PullRequest, type WebsiteRepository } from "./types";

const API = "https://api.github.com";

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function pullOf(value: unknown): PullRequest {
  const pull = asRecord(value);
  const head = asRecord(pull.head);
  const base = asRecord(pull.base);
  const merged = pull.merged === true || (typeof pull.merged_at === "string" && pull.merged_at !== "");
  return {
    number: Number(pull.number),
    url: String(pull.html_url),
    state: merged ? "merged" : pull.state === "open" ? "open" : "closed",
    headBranch: String(head.ref),
    baseBranch: String(base.ref),
    title: String(pull.title),
    mergeCommitSha: merged && typeof pull.merge_commit_sha === "string" ? pull.merge_commit_sha : null,
  };
}

export function realWebsiteRepository(repository: string, token: string, timeoutMs: number): WebsiteRepository {
  const call = async (method: string, route: string, body?: unknown): Promise<Answer> => {
    let response: Response;
    try {
      response = await fetch(`${API}/repos/${repository}${route}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new GitHubError("unavailable", "GitHub did not answer.");
    }
    if (response.status === 401 || response.status === 403) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (remaining === "0" || response.headers.has("retry-after")) {
        const wait = Number(response.headers.get("retry-after"));
        throw new GitHubError("rateLimited", "GitHub asked the portal to wait.", Number.isFinite(wait) ? wait : 60);
      }
      throw new GitHubError("accessLost", "GitHub refused the credential.");
    }
    if (response.status === 429) throw new GitHubError("rateLimited", "GitHub asked the portal to wait.", 60);
    if (response.status === 404) throw new GitHubError("notFound", "GitHub found no such resource.");
    if (response.status === 409 || response.status === 422) {
      throw new GitHubError("conflict", "GitHub refused the change as conflicting.");
    }
    if (!response.ok) throw new GitHubError("unavailable", "GitHub answered with an error.");
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };

  const branchHead = async (branch: string): Promise<string> =>
    String(asRecord(asRecord((await call("GET", `/git/ref/heads/${encodeURIComponent(branch)}`)).body).object).sha);

  return {
    name: repository,
    branchHead,
    readFile: async (file, commit) => {
      try {
        const answer = await call(
          "GET",
          `/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${commit}`,
        );
        const content = asRecord(answer.body).content;
        return typeof content === "string" ? Buffer.from(content, "base64").toString("utf8") : null;
      } catch (error) {
        if (error instanceof GitHubError && error.kind === "notFound") return null;
        throw error;
      }
    },
    createBranch: async (branch, commit) => {
      await call("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: commit });
    },
    commitFiles: async (branch, expectedHead, files: readonly CommitFile[], message) => {
      if ((await branchHead(branch)) !== expectedHead)
        throw new GitHubError("staleBase", `The branch ${branch} moved.`);
      const parent = asRecord((await call("GET", `/git/commits/${expectedHead}`)).body);
      const baseTree = String(asRecord(parent.tree).sha);
      const tree = asRecord(
        (
          await call("POST", "/git/trees", {
            base_tree: baseTree,
            tree: files.map((file) =>
              file.content === null
                ? { path: file.path, mode: "100644", type: "blob", sha: null }
                : { path: file.path, mode: "100644", type: "blob", content: file.content },
            ),
          })
        ).body,
      );
      const commit = asRecord(
        (await call("POST", "/git/commits", { message, tree: tree.sha, parents: [expectedHead] })).body,
      );
      // Not forced: GitHub refuses the update where the branch moved meanwhile.
      await call("PATCH", `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
      return String(commit.sha);
    },
    openPullRequest: async ({ head, base, title, body }) =>
      pullOf((await call("POST", "/pulls", { head, base, title, body })).body),
    pullRequest: async (number) => pullOf((await call("GET", `/pulls/${number}`)).body),
    openPullRequests: async (prefix) => {
      const answer = await call("GET", "/pulls?state=open&per_page=100");
      return (Array.isArray(answer.body) ? answer.body : [])
        .map(pullOf)
        .filter((pull) => pull.headBranch.startsWith(prefix));
    },
    closePullRequest: async (number) => {
      await call("PATCH", `/pulls/${number}`, { state: "closed" });
    },
  };
}
