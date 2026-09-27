import 'server-only'

import { SUPABASE_URL } from '@/lib/supabase/env'

/**
 * `generateStaticParams` for pages built from the database.
 *
 * The list is an optimisation — which pages to render during `next build`
 * rather than on their first request — never a requirement: every such route
 * sets `dynamicParams = true`, so a page left out is rendered on demand and
 * then cached exactly like a prerendered one.
 *
 * So a build that cannot read the catalogue prerenders nothing instead of
 * failing: a Vercel project or CI run without the Supabase variables, or a
 * database that is briefly unreachable at build time. The deploy goes out and
 * the pages fill the cache as they are visited. It is logged, because on the
 * production project it would mean a cold cache after that deploy.
 */
export async function paramsFromDatabase<T>(label: string, read: () => Promise<T[]>): Promise<T[]> {
  if (!SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(`[build] ${label}: Supabase is not configured, nothing prerendered — pages render on first request.`)
    return []
  }
  try {
    return await read()
  } catch (error) {
    console.error(`[build] ${label}: catalogue unreadable, nothing prerendered — pages render on first request.`, error)
    return []
  }
}
