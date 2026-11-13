// Takes the manifest of a running database: every document of Firestore at every depth, every
// account of Authentication and every object of the default Cloud Storage bucket.
import { createHash } from "node:crypto";
import type { Auth, UserRecord } from "firebase-admin/auth";
import type { CollectionReference, DocumentReference, Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { type BackupManifest, contentHash, MANIFEST_FORMAT, type ManifestEntry, sortedEntries } from "./manifest";

/** The default bucket of a project, as the web configuration of the emulator names it. */
export function defaultBucketName(projectId: string): string {
  return `${projectId}.appspot.com`;
}

const GET_ALL_BATCH = 300;

async function documentsBelow(db: Firestore, collections: readonly CollectionReference[]): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  for (const collection of collections) {
    // listDocuments also returns a document that holds nothing but subcollections, whose children
    // a plain query would never reach.
    const references = await collection.listDocuments();
    for (let start = 0; start < references.length; start += GET_ALL_BATCH) {
      const batch = references.slice(start, start + GET_ALL_BATCH);
      const snapshots = batch.length === 0 ? [] : await db.getAll(...batch);
      for (const snapshot of snapshots) {
        if (snapshot.exists) entries.push({ key: snapshot.ref.path, sha256: contentHash(snapshot.data()) });
      }
    }
    for (const reference of references) {
      entries.push(...(await documentsBelow(db, await (reference as DocumentReference).listCollections())));
    }
  }
  return entries;
}

/** Every document of the database, by path, with the hash of its fields. */
export async function documentEntries(db: Firestore): Promise<ManifestEntry[]> {
  return sortedEntries(await documentsBelow(db, await db.listCollections()));
}

/** The parts of an account that a restore must bring back. Sign-in times are left out: a sign-in changes them. */
export function accountContent(user: UserRecord): unknown {
  return {
    uid: user.uid,
    email: user.email ?? null,
    emailVerified: user.emailVerified,
    disabled: user.disabled,
    displayName: user.displayName ?? null,
    phoneNumber: user.phoneNumber ?? null,
    providers: user.providerData
      .map((provider) => ({ providerId: provider.providerId, uid: provider.uid, email: provider.email ?? null }))
      .sort((a, b) => (a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0)),
    customClaims: user.customClaims ?? null,
    factors: (user.multiFactor?.enrolledFactors ?? []).map((factor) => ({
      uid: factor.uid,
      factorId: factor.factorId,
    })),
    createdAt: user.metadata.creationTime,
  };
}

/** Every account, by uid, with the hash of its content. The manifest holds no address. */
export async function accountEntries(auth: Auth): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) entries.push({ key: user.uid, sha256: contentHash(accountContent(user)) });
    pageToken = page.pageToken;
  } while (pageToken !== undefined);
  return sortedEntries(entries);
}

/** Every object of a bucket, by name, with the hash of its bytes, its type and its custom metadata. */
export async function objectEntries(storage: Storage, bucketName: string): Promise<ManifestEntry[]> {
  const bucket = storage.bucket(bucketName);
  const [files] = await bucket.getFiles();
  const entries: ManifestEntry[] = [];
  for (const file of files) {
    const [bytes] = await file.download();
    const [metadata] = await file.getMetadata();
    entries.push({
      key: file.name,
      sha256: contentHash({
        bytes: createHash("sha256").update(bytes).digest("hex"),
        contentType: metadata.contentType ?? null,
        metadata: metadata.metadata ?? null,
      }),
    });
  }
  return sortedEntries(entries);
}

export interface SnapshotHandles {
  readonly db: Firestore;
  readonly auth: Auth;
  readonly storage: Storage;
}

export async function takeManifest(
  handles: SnapshotHandles,
  projectId: string,
  now = new Date(),
): Promise<BackupManifest> {
  return {
    format: MANIFEST_FORMAT,
    projectId,
    takenAt: now.toISOString(),
    documents: await documentEntries(handles.db),
    accounts: await accountEntries(handles.auth),
    objects: await objectEntries(handles.storage, defaultBucketName(projectId)),
  };
}
