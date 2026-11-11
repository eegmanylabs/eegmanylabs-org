import type { EntityType } from "@eegml/shared";
import { entityRefId } from "@eegml/shared";
import { Star } from "lucide-react";
import { useState } from "react";
import { usePaletteActions } from "@/app/shell/palette-actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { setFavourite, useLiveQuery } from "@/data";
import { favouritesOf } from "@/registry/queries";
import { cn } from "@/utils/cn";

/**
 * Stars a record for the signed-in account, or removes the star. The favourites appear in the
 * sidebar. The rules let an account write its own favourites and nobody else's.
 */
export function FavouriteButton({
  uid,
  entityType,
  entityId,
  name,
}: {
  uid: string;
  entityType: EntityType;
  entityId: string;
  /** What the record is called, for the accessible name of the button. */
  name: string;
}) {
  const favourites = useLiveQuery(favouritesOf(uid));
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const starred =
    favourites.status === "ready" && favourites.data.some((entry) => entry.id === entityRefId(entityType, entityId));
  const toggle = async () => {
    setBusy(true);
    try {
      await setFavourite(uid, entityType, entityId, !starred);
    } catch {
      toast.show({
        title: "Your favourites could not be changed.",
        description: "Check your connection and try again.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };
  usePaletteActions(
    favourites.status === "ready"
      ? [{ id: "favourite", label: starred ? `Remove the star from ${name}` : `Star ${name}`, run: toggle }]
      : [],
    `${favourites.status}:${starred}:${entityType}:${entityId}`,
  );
  return (
    <Button
      size="sm"
      aria-pressed={starred}
      aria-label={`Star ${name}`}
      disabled={busy || favourites.status !== "ready"}
      onClick={toggle}
    >
      <Star aria-hidden="true" strokeWidth={1.8} className={cn(starred && "fill-current text-fg-accent")} />
      Star
    </Button>
  );
}
