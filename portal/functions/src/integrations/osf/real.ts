// The adapter of the real OSF programming interface (version 2), written against its public
// documentation and UNVERIFIED: it has never been executed, by a test or otherwise. Every test
// uses the fake. It reads one public resource by its identifier through the endpoint of
// identifiers, which answers with the resource whatever its kind, and sends no credential, so it
// can read nothing that is not public (docs/INTEGRATIONS.md, section 5). Before it is switched on,
// an administrator checks the shape of the answer and the rate limit against the documentation
// and records what was checked in docs/INTEGRATIONS.md.
import { type OsfAdapter, OsfError, type OsfResource, type OsfResourceKind } from "./types";

const API = "https://api.osf.io/v2";

/** The kinds of resource, by the JSON:API type that the interface names. */
const KINDS: Readonly<Record<string, OsfResourceKind>> = {
  nodes: "node",
  registrations: "registration",
  preprints: "preprint",
};

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

export function realOsfAdapter(timeoutMs: number): OsfAdapter {
  return {
    resource: async (id) => {
      let response: Response;
      try {
        response = await fetch(`${API}/guids/${encodeURIComponent(id)}/`, {
          headers: { accept: "application/vnd.api+json" },
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new OsfError("unavailable", "OSF did not answer.");
      }
      if (response.status === 404 || response.status === 410) {
        throw new OsfError("notFound", "No OSF resource has this identifier.", response.status);
      }
      if (response.status === 401 || response.status === 403) {
        throw new OsfError("restricted", "The OSF resource is not public.", response.status);
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        throw new OsfError(
          "rateLimited",
          "OSF asked the portal to slow down.",
          429,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
        );
      }
      if (!response.ok) throw new OsfError("unavailable", "OSF answered with an error.", response.status);
      const body = (await response.json()) as {
        data?: { type?: unknown; id?: unknown; attributes?: Record<string, unknown> };
      };
      const kind = KINDS[String(body.data?.type)];
      const attributes = body.data?.attributes ?? {};
      const title = text(attributes.title);
      if (kind === undefined || title === null) {
        throw new OsfError("unavailable", "OSF answered in a form the portal does not read.", response.status);
      }
      return {
        id: text(body.data?.id) ?? id,
        kind,
        title,
        dateModified: text(attributes.date_modified),
        dateRegistered: text(attributes.date_registered),
        withdrawn: attributes.withdrawn === true,
      } satisfies OsfResource;
    },
  };
}
