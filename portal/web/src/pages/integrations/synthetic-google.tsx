// What the integrations say about Google in an emulator build, where every Google service is the
// synthetic fake of the functions (docs/INTEGRATIONS.md, section 3.8). Vite replaces the mode's
// name when it builds, so staging and production always name Google itself.
import { Info } from "lucide-react";

/** Whether this build talks to the emulator, whose Google Drive, Sheets and Docs are a synthetic fake. */
export const SYNTHETIC_GOOGLE = import.meta.env.MODE === "emulator";

/** The label of a link that opens an item at its own address. */
export const OPEN_ITEM_LABEL = SYNTHETIC_GOOGLE ? "Open the synthetic file" : "Open in Google";

/** The notice that the files shown here are synthetic, shown only in an emulator build. */
export function SyntheticGoogleNotice() {
  if (!SYNTHETIC_GOOGLE) return null;
  return (
    <p className="flex items-start gap-2 text-sm text-fg-secondary" data-testid="synthetic-google">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
      Google is a synthetic fake in this build: these files exist only in the emulator, and their addresses lead to
      example.org.
    </p>
  );
}
