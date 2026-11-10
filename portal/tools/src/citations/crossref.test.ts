// Unit tests of the look-up of a DOI. No request leaves the process: the registry is a function
// of the test. Every work, author and DOI here is invented.
import { describe, expect, it } from "vitest";
import { ToolRefusal } from "../environment";
import { CLIENT_NAME, lookUpDoi, workOfMessage, worksAddress } from "./crossref";

const MESSAGE = {
  DOI: "10.1000/invented(2001)01",
  title: ["An invented study of nothing in particular"],
  subtitle: ["With a subtitle"],
  issued: { "date-parts": [[2001, 3, 9]] },
  "published-online": { "date-parts": [[2000, 12]] },
  "published-print": { "date-parts": [[2001]] },
  author: [
    { given: "Bo", family: "Authors", sequence: "additional" },
    { given: "Ada", family: "Invented", sequence: "first" },
  ],
  "container-title": ["Journal of Synthetic Results"],
  type: "journal-article",
  reference: [{ key: "something the check never keeps" }],
};

function registry(answer: () => Response) {
  const requests: { readonly url: string; readonly headers: Record<string, string> }[] = [];
  const fetchImplementation = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requests.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
    return Promise.resolve(answer());
  }) as typeof fetch;
  return { requests, fetchImplementation };
}

describe("workOfMessage", () => {
  it("keeps the fields that the check compares, the first author by sequence, and every year once", () => {
    expect(workOfMessage("10.1000/asked", MESSAGE)).toEqual({
      doi: "10.1000/invented(2001)01",
      title: "An invented study of nothing in particular",
      subtitle: "With a subtitle",
      years: [2000, 2001],
      firstAuthorFamily: "Invented",
      firstAuthorGiven: "Ada",
      containerTitle: "Journal of Synthetic Results",
      type: "journal-article",
    });
  });

  it("reads a work without authors, dates or a title as a work with nothing to compare", () => {
    expect(workOfMessage("10.1000/asked", {})).toEqual({
      doi: "10.1000/asked",
      title: null,
      subtitle: null,
      years: [],
      firstAuthorFamily: null,
      firstAuthorGiven: null,
      containerTitle: null,
      type: null,
    });
    expect(workOfMessage("10.1000/asked", { author: [{ name: "An Invented Consortium" }] })?.firstAuthorFamily).toBe(
      "An Invented Consortium",
    );
    expect(workOfMessage("10.1000/asked", "no object")).toBeNull();
  });
});

describe("lookUpDoi", () => {
  it("asks for the DOI and sends a generic client name, and nothing that names a person or a project", async () => {
    const { requests, fetchImplementation } = registry(() => Response.json({ status: "ok", message: MESSAGE }));
    const answer = await lookUpDoi("10.1000/invented(2001)01", { fetchImplementation });
    expect(answer).toMatchObject({ status: "found", work: { firstAuthorFamily: "Invented", years: [2000, 2001] } });
    expect(requests).toEqual([
      {
        url: "https://api.crossref.org/works/10.1000%2Finvented(2001)01",
        headers: { Accept: "application/json", "User-Agent": CLIENT_NAME },
      },
    ]);
    expect(CLIENT_NAME).not.toMatch(/@|mailto|eeg/i);
  });

  it("tells a DOI that another agency registered from one that nobody holds", async () => {
    const agencyOf = (id: string) => {
      let asked = 0;
      return registry(() => {
        asked += 1;
        return asked === 1
          ? new Response("Resource not found.", { status: 404 })
          : Response.json({ message: { DOI: "10.1000/data.1", agency: { id, label: "An agency" } } });
      });
    };
    const elsewhere = agencyOf("datacite");
    expect(await lookUpDoi("10.1000/data.1", elsewhere)).toEqual({ status: "otherAgency", agency: "datacite" });
    expect(elsewhere.requests.map((request) => request.url)).toEqual([
      "https://api.crossref.org/works/10.1000%2Fdata.1",
      "https://api.crossref.org/works/10.1000%2Fdata.1/agency",
    ]);
    // Crossref registered the DOI and holds no work under it: there is nothing to compare, and nothing elsewhere.
    expect(await lookUpDoi("10.1000/data.1", agencyOf("crossref"))).toEqual({ status: "notFound" });
  });

  it("tells a DOI that the registry does not hold from a registry that could not be asked", async () => {
    const missing = registry(() => new Response("Resource not found.", { status: 404 }));
    expect(await lookUpDoi("10.1000/none", missing)).toEqual({ status: "notFound" });
    const busy = registry(() => new Response("", { status: 503 }));
    expect(await lookUpDoi("10.1000/none", busy)).toEqual({ status: "unavailable", reason: "status503" });
    const unreadable = registry(() => new Response("<html>", { status: 200 }));
    expect(await lookUpDoi("10.1000/none", unreadable)).toEqual({ status: "unavailable", reason: "unreadable" });
    const silent = { fetchImplementation: (() => Promise.reject(new Error("no route"))) as typeof fetch };
    expect(await lookUpDoi("10.1000/none", silent)).toEqual({ status: "unavailable", reason: "noAnswer" });
  });

  it("refuses a registry address that would not travel encrypted, except on this machine", () => {
    expect(() => worksAddress("http://registry.example.org/works/")).toThrow(ToolRefusal);
    expect(() => worksAddress("not an address")).toThrow(ToolRefusal);
    expect(worksAddress("http://127.0.0.1:9/works").href).toBe("http://127.0.0.1:9/works/");
    expect(worksAddress().href).toBe("https://api.crossref.org/works/");
  });
});
