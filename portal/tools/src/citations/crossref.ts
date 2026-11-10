// The look-up of a DOI at Crossref, the registry of DOIs of scholarly works.
//
// A request names the DOI and nothing else. It carries a generic client name and no address, no
// name of a person and no credential. The answer is read into the few fields that the citation
// check compares, and nothing else of it is kept.
import { ToolRefusal } from "../environment";
import type { RetrievedWork } from "./compare";

/** The public interface of Crossref for one work. */
export const CROSSREF_WORKS = "https://api.crossref.org/works/";

/** How the check names its source on a record. */
export const CROSSREF_SOURCE = "Crossref";

/** The client name sent with every request. It identifies the kind of tool and nobody. */
export const CLIENT_NAME = "citation-check/1.0";

export type CrossrefAnswer =
  | { readonly status: "found"; readonly work: RetrievedWork }
  /** No registry of DOIs that Crossref knows holds the DOI. */
  | { readonly status: "notFound" }
  /** The DOI exists and another agency registered it, such as DataCite. Crossref holds no metadata to compare. */
  | { readonly status: "otherAgency"; readonly agency: string }
  /** The registry could not be asked, or its answer could not be read. The citation stays as it is. */
  | { readonly status: "unavailable"; readonly reason: string };

export interface CrossrefOptions {
  /** Another address for the interface, which the tests use. Plain HTTP is accepted for this machine alone. */
  readonly apiBase?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The address of the interface, or a refusal where a request would not travel encrypted. */
export function worksAddress(apiBase: string = CROSSREF_WORKS): URL {
  let url: URL;
  try {
    url = new URL(apiBase.endsWith("/") ? apiBase : `${apiBase}/`);
  } catch {
    throw new ToolRefusal("Refusing to run: --api is no address.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new ToolRefusal("Refusing to run: the address of the citation registry does not use HTTPS.");
  }
  return url;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const firstText = (value: unknown): string | null => (Array.isArray(value) ? text(value[0]) : text(value));

/** The year of a date as Crossref writes it: `{ "date-parts": [[2004, 2, 22]] }`. */
function yearOf(value: unknown): number | null {
  const parts = (value as { "date-parts"?: unknown } | null | undefined)?.["date-parts"];
  const year = Array.isArray(parts) && Array.isArray(parts[0]) ? (parts[0] as unknown[])[0] : undefined;
  return typeof year === "number" && Number.isInteger(year) && year >= 1500 && year <= 2200 ? year : null;
}

/** Reads the message of a Crossref answer into the fields that the check compares. Null where it is no work. */
export function workOfMessage(doi: string, message: unknown): RetrievedWork | null {
  if (typeof message !== "object" || message === null) return null;
  const fields = message as Record<string, unknown>;
  const authors = Array.isArray(fields.author) ? (fields.author as Record<string, unknown>[]) : [];
  const first = authors.find((author) => author?.sequence === "first") ?? authors[0];
  const years = ["issued", "published", "published-print", "published-online"]
    .map((name) => yearOf(fields[name]))
    .filter((year): year is number => year !== null);
  return {
    doi: text(fields.DOI) ?? doi,
    title: firstText(fields.title),
    subtitle: firstText(fields.subtitle),
    years: [...new Set(years)].sort((a, b) => a - b),
    // An organisation as author has a name and no family name.
    firstAuthorFamily: first === undefined ? null : (text(first.family) ?? text(first.name)),
    firstAuthorGiven: first === undefined ? null : text(first.given),
    containerTitle: firstText(fields["container-title"]),
    type: text(fields.type),
  };
}

/**
 * Asks Crossref for one DOI. It never throws for an answer or a failure of the network. Where
 * Crossref holds no work under the DOI, it is asked which agency registered the DOI, because a
 * DOI of a data repository is registered elsewhere and is not missing.
 */
export async function lookUpDoi(doi: string, options: CrossrefOptions = {}): Promise<CrossrefAnswer> {
  const base = worksAddress(options.apiBase);
  const ask = async (address: URL): Promise<Response | null> => {
    try {
      return await (options.fetchImplementation ?? fetch)(address, {
        headers: { Accept: "application/json", "User-Agent": CLIENT_NAME },
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
    } catch {
      return null;
    }
  };
  const response = await ask(new URL(encodeURIComponent(doi), base));
  if (response === null) return { status: "unavailable", reason: "noAnswer" };
  if (response.status === 404) {
    const registered = await ask(new URL(`${encodeURIComponent(doi)}/agency`, base));
    if (registered === null) return { status: "unavailable", reason: "noAnswer" };
    if (registered.status === 404) return { status: "notFound" };
    if (!registered.ok) return { status: "unavailable", reason: `status${registered.status}` };
    try {
      const body = (await registered.json()) as { message?: { agency?: { id?: unknown } } };
      const agency = text(body.message?.agency?.id);
      if (agency === null) return { status: "unavailable", reason: "unreadable" };
      return agency === "crossref" ? { status: "notFound" } : { status: "otherAgency", agency };
    } catch {
      return { status: "unavailable", reason: "unreadable" };
    }
  }
  if (!response.ok) return { status: "unavailable", reason: `status${response.status}` };
  try {
    const body = (await response.json()) as { message?: unknown };
    const work = workOfMessage(doi, body.message);
    return work === null ? { status: "unavailable", reason: "unreadable" } : { status: "found", work };
  } catch {
    return { status: "unavailable", reason: "unreadable" };
  }
}
