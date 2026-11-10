// Typed references to the documents the web application reads. Paths come from @eegml/shared,
// shapes from its schemas, so this file contains no collection name and no field name.
import { type AccessDoc, accessDocSchema, paths, type UserDoc, userDocSchema } from "@eegml/shared";
import { doc } from "firebase/firestore";
import { schemaConverter, type WithId } from "./converter";
import { db } from "./firebase";

const userConverter = schemaConverter("user", userDocSchema);
const accessConverter = schemaConverter("access document", accessDocSchema);

export const refs = {
  user: (uid: string) => doc(db, paths.user(uid)).withConverter(userConverter),
  access: (uid: string) => doc(db, paths.access(uid)).withConverter(accessConverter),
} as const;

export type UserRecord = WithId<UserDoc>;
export type AccessRecord = WithId<AccessDoc>;
