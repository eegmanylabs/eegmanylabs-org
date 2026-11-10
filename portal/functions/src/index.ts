// Entry point of the deployed functions. Every export of this file is a Cloud Function.
import { FUNCTIONS_REGION } from "@eegml/shared";
import { setGlobalOptions } from "firebase-functions";

// Applies to every function, including triggers and scheduled jobs added later.
setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 10, memory: "256MiB" });

export { sessionStart } from "./callables/sessionStart";
