// The triggers that keep comments, linked documents and the followers of records up to date
// (requirements R15.8, R16.1 and R16.4).
//
// | Function                          | Runs on                              | Does |
// |-----------------------------------|--------------------------------------|------|
// | `searchOnCommentWritten`          | A comment created, edited or deleted | Brings the comment's entries in the search index in line with it |
// | `searchOnDocumentLinkWritten`     | A linked document written            | Brings its entries in line with it |
// | `followersOnActivityCreated`      | An entry of activity                 | Tells the members who follow the record |
// | `notifyOnProtocolVersionWritten`  | A version of a protocol written      | Tells the team and the coordinators once it is approved |
// | `notifyOnManuscriptWritten`       | A manuscript written                 | Tells the team when it reaches a milestone |
import { COLLECTIONS, systemActor, systemWriteContext } from "@eegml/shared";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/firestore";
import { firestore } from "../framework/admin";
import { documentTrigger } from "../framework/trigger";
import { MILESTONE_STATUSES, notifyFollowers, notifyMilestone, notifyProtocolUpdate } from "../notifications/followers";
import { indexComment, indexDocumentLink } from "../search/entries";

const INDEX_ACTOR = systemActor("searchIndex");

export const searchOnCommentWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.threadComments.path),
  async (event) => {
    await indexComment(firestore(), event.params.threadId, event.params.commentId, {
      at: new Date(event.time),
      actor: INDEX_ACTOR,
      writeContext: systemWriteContext(),
    });
  },
);

export const searchOnDocumentLinkWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.documentLinks.path),
  async (event) => {
    await indexDocumentLink(firestore(), event.params.id, {
      at: new Date(event.time),
      actor: INDEX_ACTOR,
      writeContext: systemWriteContext(),
    });
  },
);

export const followersOnActivityCreated = onDocumentCreated(
  documentTrigger(COLLECTIONS.activity.path),
  async (event) => {
    await notifyFollowers(firestore(), event.params.eventId, new Date(event.time));
  },
);

export const notifyOnProtocolVersionWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.replicationProtocolVersions.path),
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (after === undefined || after.status !== "approved" || before?.status === "approved") return;
    const db = firestore();
    const protocol =
      typeof after.protocolId === "string"
        ? await db.doc(COLLECTIONS.replicationProtocols.docPath(event.params.studyKey, after.protocolId)).get()
        : null;
    const protocolTitle = protocol?.get("title");
    await notifyProtocolUpdate(
      db,
      {
        replicationId: event.params.studyKey,
        versionId: event.params.id,
        versionLabel: typeof after.versionLabel === "string" ? after.versionLabel : event.params.id,
        protocolTitle: typeof protocolTitle === "string" ? protocolTitle : null,
        approvedBy: typeof after.approvedBy === "string" ? after.approvedBy : null,
      },
      new Date(event.time),
    );
  },
);

export const notifyOnManuscriptWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.manuscripts.path),
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const status = MILESTONE_STATUSES.find((candidate) => candidate === after?.status);
    if (after === undefined || status === undefined || before?.status === status) return;
    if (typeof after.replicationId !== "string") return;
    await notifyMilestone(
      firestore(),
      {
        manuscriptId: event.params.id,
        replicationId: after.replicationId,
        status,
        title: typeof after.title === "string" ? after.title : event.params.id,
      },
      new Date(event.time),
    );
  },
);
