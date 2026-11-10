// The only file in the portal that imports "zod" directly. Everything else imports `z` from
// "@eegml/shared".
//
// zod compiles object parsers with `new Function` and probes for that on the first parse. The
// portal's Content-Security-Policy has no 'unsafe-eval', so the probe would be blocked and
// reported as a violation. Jitless mode switches the compiler and the probe off. It is set here,
// before any schema can be used, so no consumer can forget it.
import { z } from "zod";

z.config({ jitless: true });

export { z };
