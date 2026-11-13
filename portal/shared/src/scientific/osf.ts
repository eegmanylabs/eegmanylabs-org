// Reading an OSF address (docs/INTEGRATIONS.md, section 5). The page host answers success for a
// made-up address, so the portal never checks an OSF link by its page: it takes the identifier
// from the address and asks the OSF interface about that identifier.

/** The words of the first path segment that name a page of OSF itself rather than a resource. */
const RESERVED_SEGMENTS = new Set(["preprints", "registries", "search", "institutions", "collections", "meetings"]);

/**
 * The identifier of the OSF resource an address points at, or null where the address is no OSF
 * resource: `https://osf.io/abc12/`, `https://osf.io/abc12/files/` and
 * `https://osf.io/preprints/psyarxiv/abc12` all name `abc12`.
 */
export function osfIdentifierOf(address: string): string | null {
  const match = /^https?:\/\/(?:www\.)?osf\.io(\/[^?#]*)?(?:[?#].*)?$/i.exec(address.trim());
  if (match === null) return null;
  const segments = (match[1] ?? "").split("/").filter((segment) => segment !== "");
  const candidate =
    segments[0] === "preprints" ? segments[2] : RESERVED_SEGMENTS.has(segments[0] ?? "") ? undefined : segments[0];
  return candidate !== undefined && /^[a-z0-9]{5,10}$/i.test(candidate) ? candidate.toLowerCase() : null;
}
