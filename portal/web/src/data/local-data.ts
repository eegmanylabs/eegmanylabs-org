// What the browser keeps of an account's data, and how it is thrown away.
import { clearIndexedDbPersistence, terminate } from "firebase/firestore";
import { db } from "./firebase";
import { closeLiveData } from "./live";

/**
 * Throws away everything this page holds of the account's data: the live values in memory, the
 * connection to Firestore and the copy of the documents that Firestore keeps in IndexedDB.
 *
 * Call it when the account goes away, in this tab or in another, and load the page afresh
 * afterwards: the Firestore client cannot be used again. The fresh page starts no Firestore
 * client until someone is signed in. That matters for more than privacy. A tab that kept a
 * signed-out client running would stay the one tab that talks to the server for all tabs, and
 * the server would refuse what a newly signed-in tab asks for through it.
 *
 * It never rejects. The copy in IndexedDB can only be deleted once no tab uses it, so with
 * several tabs open the last one to get here deletes it.
 */
export async function discardLocalData(): Promise<void> {
  closeLiveData();
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (error) {
    // Another tab still has the database open. That tab clears it when it gets here.
    console.warn("The local copy of the portal's data could not be cleared yet.", (error as { code?: unknown }).code);
  }
}
