// The notes of a record: the page that is the body of a replication, a laboratory or a member
// (docs/DATA_MODEL.md, section 9). The page is created the first time anyone opens it, with the
// audience of its record, by the callable function openEntityPage.
import { type EntityPageType, openEntityPageContract } from "@eegml/shared";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { useCallResult } from "@/data";
import { PageView } from "./PageView";

export function NotesTab({ entityType, entityId }: { readonly entityType: EntityPageType; readonly entityId: string }) {
  const opened = useCallResult(openEntityPageContract, { entityType, entityId }, `${entityType}/${entityId}`);
  switch (opened.live.status) {
    case "idle":
    case "loading":
      return <LoadingState label="Opening the notes" />;
    case "error":
      return (
        <ErrorState
          title="The notes could not be opened."
          description={opened.live.error.message}
          action={<Button onClick={opened.reload}>Try again</Button>}
        />
      );
    case "ready":
      return <PageView pageId={opened.live.data.pageId} embedded />;
  }
}
