// UNVERIFIED. Written from the vendor documentation and never run: no Google credential exists
// and the portal makes no live Google call (docs/INTEGRATIONS.md, section 3.7). Nothing in the
// emulator or in any test reaches this file.
//
// The transport of the real adapters: a short-lived access token from the platform's metadata
// server, which Google documents for Cloud Run functions, and JSON requests whose failures
// become `ExternalServiceError`. No key is stored anywhere.
import { ExternalServiceError, type GoogleService } from "../types";

const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/** The smallest set of scopes the jobs need, as section 3.1 describes it. A live check settles it. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
] as const;

let cached: { readonly token: string; readonly expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached !== null && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const response = await fetch(`${METADATA_TOKEN_URL}?scopes=${encodeURIComponent(GOOGLE_SCOPES.join(","))}`, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!response.ok)
    throw new ExternalServiceError("drive", response.status, null, "No access token from the platform.");
  const body = (await response.json()) as { readonly access_token?: unknown; readonly expires_in?: unknown };
  if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
    throw new ExternalServiceError("drive", 500, null, "The platform answered without an access token.");
  }
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

/** A JSON object of an answer, read field by field without trusting its shape. */
export type Json = { readonly [key: string]: unknown };

export function asObject(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

/** Sends a request and answers its JSON body, or throws the error Google gave. */
export async function googleRequest(
  service: GoogleService,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
): Promise<Json> {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const json = text === "" ? {} : asObject(JSON.parse(text));
  if (response.ok) return json;
  const error = asObject(json.error);
  const first = asObject(asArray(error.errors)[0]);
  const retryAfter = Number(response.headers.get("retry-after"));
  throw new ExternalServiceError(
    service,
    response.status,
    asString(first.reason, asString(error.status)) || null,
    asString(error.message, `HTTP ${response.status}`),
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
  );
}
