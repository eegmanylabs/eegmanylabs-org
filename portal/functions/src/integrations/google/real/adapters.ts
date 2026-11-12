// UNVERIFIED. The real adapters of the three services, never run (see http.ts).
import type { WorkspaceAdapters } from "../types";
import { realDocs } from "./docs";
import { realDrive } from "./drive";
import { realSheets } from "./sheets";

export function realAdapters(): WorkspaceAdapters {
  return { drive: realDrive(), sheets: realSheets(), docs: realDocs(), kind: "real" };
}
