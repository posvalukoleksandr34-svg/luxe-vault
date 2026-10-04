'use client'

import { useStore } from '@/lib/store'
import type { Locale } from '@/lib/types'

/**
 * Chrome shared by the three legal documents.
 *
 * Client components for the same reason as <LegalDocument>: these strings used
 * to be hardcoded Russian, so an English or Italian reader got a correctly
 * translated policy wrapped in Cyrillic notices.
 *
 * `_shared` — the leading underscore makes this a private folder-mate that the
 * App Router ignores, so it never becomes a /legal/_shared route.
 */

export const LAST_UPDATED: Record<Locale, string> = {
  ru: '4 октября 2026',
  en: '4 October 2026',
  it: '4 ottobre 2026',
  fr: '4 octobre 2026',
  de: '4. Oktober 2026',
}

export const OPERATOR = {
  name: 'Luxe Vault',
  site: 'luxe-vault.store',
  support: 'support@luxe-vault.store',
  telegram: '@luxevault_orders',
}

const FOOTER: Record<Locale, { updated: string; questions: string }> = {
  ru: { updated: 'Последнее обновление', questions: 'Вопросы' },
  en: { updated: 'Last updated', questions: 'Questions' },
  it: { updated: 'Ultimo aggiornamento', questions: 'Domande' },
  fr: { updated: 'Dernière mise à jour', questions: 'Questions' },
  de: { updated: 'Zuletzt aktualisiert', questions: 'Fragen' },
}

export function Footer() {
  const { locale } = useStore()
  const c = FOOTER[locale] ?? FOOTER.en
  return (
    <p className="mt-12 border-t border-border/40 pt-6 text-[12px] text-muted-foreground/85">
      {c.updated}: {LAST_UPDATED[locale] ?? LAST_UPDATED.en}. {c.questions}:{' '}
      <a href={`mailto:${OPERATOR.support}`}>{OPERATOR.support}</a>
    </p>
  )
}
