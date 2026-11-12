// UNVERIFIED. Written from the documentation of the Amazon S3 interface (ListObjectsV2,
// GetObject and Signature Version 4), which most object stores also offer, and never run: no
// object store account exists (docs/INTEGRATIONS.md, section 7). Nothing in the emulator or in
// any test reaches it.
//
// Object storage over HTTPS with path-style addresses: the host of the endpoint is the service,
// the first segment of the base path is the bucket, and the rest of it and the copy's path form
// the prefix. A page of a listing is one ListObjectsV2 request, whose cursor is the continuation
// token, and a checksum file is read with GetObject. The secret holds `host`, `accessKeyId`,
// `secretAccessKey` and `region` of a key that may only list and read.
import { createHash, createHmac } from "node:crypto";
import { type ListedFile, type StorageAdapter, StorageError, type StorageTarget } from "../types";
import { credentialOf, remotePath } from "./credentials";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const hmac = (key: Buffer | string, text: string) => createHmac("sha256", key).update(text, "utf8").digest();
const encode = (text: string) =>
  encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** A signed GET request of Signature Version 4, with an empty body. */
async function signedGet(
  target: StorageTarget,
  objectPath: string,
  query: Readonly<Record<string, string>>,
): Promise<Response> {
  const secret = credentialOf(target, ["accessKeyId", "secretAccessKey", "region"]);
  const host = target.port === null ? target.host : `${target.host}:${target.port}`;
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${encode(key)}=${encode(query[key] ?? "")}`)
    .join("&");
  const canonicalPath = objectPath.split("/").map(encode).join("/");
  const payloadHash = sha256("");
  const headers = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const request = ["GET", canonicalPath, canonicalQuery, headers, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${secret.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(request)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secret.secretAccessKey}`, day), secret.region ?? ""), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(toSign, "utf8").digest("hex");
  let response: Response;
  try {
    response = await fetch(`https://${host}${canonicalPath}${canonicalQuery === "" ? "" : `?${canonicalQuery}`}`, {
      headers: {
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        Authorization: `AWS4-HMAC-SHA256 Credential=${secret.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    });
  } catch {
    throw new StorageError("unreachable", "The object store did not answer.");
  }
  if (response.status === 403) throw new StorageError("permissionDenied", "The object store refused the key.");
  if (response.status === 404) throw new StorageError("notFound", "The bucket or the object does not exist.");
  if (!response.ok)
    throw new StorageError(
      response.status >= 500 ? "unreachable" : "failed",
      `The object store answered ${response.status}.`,
    );
  return response;
}

/** The bucket and the prefix of a copy. */
function bucketAndPrefix(target: StorageTarget): { bucket: string; prefix: string } {
  const [bucket = "", ...rest] = remotePath(target).slice(1).split("/");
  if (bucket === "") throw new StorageError("failed", "The base path of the endpoint names no bucket.");
  return { bucket, prefix: rest.length === 0 ? "" : `${rest.join("/")}/` };
}

const tagValues = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => match[1] ?? "");

const unescapeXml = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

export const s3Adapter: StorageAdapter = {
  check: async (target) => {
    const { bucket, prefix } = bucketAndPrefix(target);
    await signedGet(target, `/${bucket}`, { "list-type": "2", "max-keys": "1", prefix });
    return "The object store answered.";
  },
  list: async (target, cursor) => {
    const { bucket, prefix } = bucketAndPrefix(target);
    const response = await signedGet(target, `/${bucket}`, {
      "list-type": "2",
      prefix,
      "max-keys": "1000",
      ...(cursor === null ? {} : { "continuation-token": cursor }),
    });
    const xml = await response.text();
    const files: ListedFile[] = tagValues(xml, "Contents").map((entry) => ({
      relativePath: unescapeXml(tagValues(entry, "Key")[0] ?? "").slice(prefix.length),
      sizeBytes: Number(tagValues(entry, "Size")[0] ?? 0),
      modifiedAt: tagValues(entry, "LastModified")[0] ?? null,
    }));
    const truncated = tagValues(xml, "IsTruncated")[0] === "true";
    const next = tagValues(xml, "NextContinuationToken")[0];
    return {
      files: files.filter((file) => file.relativePath !== ""),
      nextCursor: truncated && next !== undefined ? next : null,
    };
  },
  readText: async (target, relativePath, maxBytes) => {
    const { bucket, prefix } = bucketAndPrefix(target);
    const response = await signedGet(target, `/${bucket}/${prefix}${relativePath}`, {});
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > maxBytes) throw new StorageError("failed", "The object is larger than a checksum file may be.");
    return response.text();
  },
};
