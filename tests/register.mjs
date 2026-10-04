// Lets `node --test` run the app's TypeScript modules directly (Node's type
// stripping), resolving what the bundler normally does: the `@/` alias,
// extensionless imports, and `server-only` (a marker package that throws
// outside a React Server Components build — irrelevant to these tests).
import { register } from 'node:module'

register('./loader.mjs', import.meta.url)
