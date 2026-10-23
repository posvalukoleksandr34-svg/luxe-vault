import 'server-only'

import { settingsFrom, type ReviewRequestSettings } from '@/lib/review-requests'
import { createAdminClient } from '@/lib/supabase/admin'

/** One row in store_settings (0028). Nothing secret in it. */
const KEY = 'review_requests'

export async function readReviewRequestSettings(): Promise<{ settings: ReviewRequestSettings; source: 'database' | 'defaults' }> {
  const { data, error } = await createAdminClient().from('store_settings').select('value').eq('key', KEY).maybeSingle()
  if (error) throw new Error(`Could not read review request settings: ${error.message}`)
  if (!data) return { settings: settingsFrom(null), source: 'defaults' }
  return { settings: settingsFrom((data as { value: unknown }).value), source: 'database' }
}

/** Validated by the caller (reviewRequestSettingsSchema). */
export async function saveReviewRequestSettings(settings: ReviewRequestSettings): Promise<void> {
  const { error } = await createAdminClient()
    .from('store_settings')
    .upsert({ key: KEY, value: settings, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(`Could not save review request settings: ${error.message}`)
}
