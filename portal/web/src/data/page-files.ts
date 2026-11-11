// The files of a page in Cloud Storage (D-010). The page body holds the path of a file with the
// scheme `PAGE_FILE_SCHEME`, never a download address: a file is read with the reader's own
// credentials each time, so the storage rules, which follow the page, decide every read.
import {
  PAGE_FILE_MAX_BYTES,
  PAGE_FILE_SCHEME,
  pageFileContentType,
  pageFilePath,
  pageFileServedType,
} from "@eegml/shared";
import { getBlob, ref, uploadBytes } from "firebase/storage";
import { storage } from "./firebase";

/** Why a file was not stored, in words that can be shown as they stand. */
export class PageFileError extends Error {
  override readonly name = "PageFileError";
}

/** Twenty letters and digits, the shape the storage rules ask of the folder of a file. */
function fileId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const random = new Uint8Array(20);
  crypto.getRandomValues(random);
  return Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
}

/** Stores a file of a page in the caller's name and returns the address the page body keeps. */
export async function uploadPageFile(pageId: string, uid: string, file: File): Promise<string> {
  if (file.size > PAGE_FILE_MAX_BYTES) {
    throw new PageFileError(`The file is larger than ${PAGE_FILE_MAX_BYTES / (1024 * 1024)} MB.`);
  }
  const path = pageFilePath(pageId, fileId(), file.name);
  try {
    await uploadBytes(ref(storage, path), file, {
      // A type that a browser would run as a document, such as HTML or SVG, is stored as bytes.
      contentType: pageFileContentType(file.type),
      customMetadata: { uploadedBy: uid },
    });
  } catch {
    throw new PageFileError("The file could not be stored. Your account may not add files to this page.");
  }
  return `${PAGE_FILE_SCHEME}${path}`;
}

/**
 * The address a browser shows a file of a page at: a local `blob:` address of the bytes, read
 * with the reader's credentials. A `blob:` address has the portal's own origin, so only an image
 * keeps its type; every other file is given as bytes, which a browser downloads and never
 * renders as a document of the portal. Any other address is returned as it is.
 */
export async function pageFileUrl(address: string): Promise<string> {
  if (!address.startsWith(PAGE_FILE_SCHEME)) return address;
  const blob = await getBlob(ref(storage, address.slice(PAGE_FILE_SCHEME.length)));
  return URL.createObjectURL(new Blob([blob], { type: pageFileServedType(blob.type) }));
}
