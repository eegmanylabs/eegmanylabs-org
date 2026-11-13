// The interface through which the portal reads OSF (docs/INTEGRATIONS.md, section 5). The portal
// only reads: the metadata of a public project, registration, preprint or file, by its
// identifier. Nothing is ever written to OSF, and nothing is read from a resource that is not
// public. A fake serves every test (fake.ts) and a real adapter is written against the public
// documentation of the OSF programming interface (real.ts), unverified and never executed.

/** The kinds of OSF resource the portal reads, by the path of the programming interface that serves each. */
export type OsfResourceKind = "node" | "registration" | "preprint";

/** What the portal keeps of a public OSF resource. */
export interface OsfResource {
  readonly id: string;
  readonly kind: OsfResourceKind;
  readonly title: string;
  /** ISO 8601 text, as the interface states it. */
  readonly dateModified: string | null;
  /** For a registration: when it was registered, as ISO 8601 text. */
  readonly dateRegistered: string | null;
  /** For a registration: whether it was withdrawn. A withdrawn registration keeps its page. */
  readonly withdrawn: boolean;
}

/**
 * | Kind          | Meaning                                                                   |
 * |---------------|---------------------------------------------------------------------------|
 * | `notFound`    | No resource has the identifier, or it was deleted                         |
 * | `restricted`  | The resource exists and is not public: the portal may not read it         |
 * | `rateLimited` | OSF asked the portal to slow down. `retryAfterSeconds` says for how long   |
 * | `unavailable` | OSF did not answer, or answered with an error of its own                  |
 */
export type OsfErrorKind = "notFound" | "restricted" | "rateLimited" | "unavailable";

export class OsfError extends Error {
  constructor(
    readonly kind: OsfErrorKind,
    message: string,
    readonly httpStatus: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

export interface OsfAdapter {
  /** Reads a resource by its identifier, whatever its kind, or throws an `OsfError`. */
  resource(id: string): Promise<OsfResource>;
}
