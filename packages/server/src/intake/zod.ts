/**
 * zod is installed for @ledger/schema but is not yet a dependency of
 * @ledger/server, so `import { z } from "zod"` does not resolve here under
 * pnpm. Until the lead adds `"zod": "^4.6.5"` to packages/server/package.json,
 * borrow that same copy (same version, same module instance) by path.
 * Then replace this line with: export { z } from "zod";
 */
export { z } from "../../../schema/node_modules/zod/index.js";
