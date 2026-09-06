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
  ru: '6 сентября 2026',
  en: '6 September 2026',
  it: '6 settembre 2026',
  fr: '6 septembre 2026',
  de: '6. September 2026',
}

export const OPERATOR = {
  name: 'Luxe Vault',
  site: 'luxe-vault.store',
  support: 'support@luxe-vault.store',
  telegram: '@luxevault_orders',
}

const DRAFT: Record<Locale, { label: string; body: string }> = {
  ru: {
    label: 'Требуется юридическая проверка.',
    body: 'Документ составлен для частной продажи (Privatverkauf) из Швейцарии. Перед публикацией согласуйте текст с юристом, практикующим в Швейцарии, — в частности, вопрос о признании деятельности предпринимательской и о представителе в ЕС по ст. 27 GDPR.',
  },
  en: {
    label: 'Legal review required.',
    body: 'Drafted for a private sale (Privatverkauf) from Switzerland. Before publishing, have this reviewed by a lawyer practising in Switzerland — in particular whether the activity qualifies as commercial, and whether an EU representative under Art. 27 GDPR is needed.',
  },
  it: {
    label: 'Richiede revisione legale.',
    body: 'Redatto per una vendita tra privati (Privatverkauf) dalla Svizzera. Prima della pubblicazione fai revisionare il testo da un avvocato che eserciti in Svizzera — in particolare se l’attività sia qualificabile come commerciale e se occorra un rappresentante UE ai sensi dell’art. 27 GDPR.',
  },
  fr: {
    label: 'Révision juridique nécessaire.',
    body: 'Rédigé pour une vente entre particuliers (Privatverkauf) depuis la Suisse. Avant publication, faites relire ce texte par un avocat exerçant en Suisse — notamment sur la qualification commerciale de l’activité et sur la nécessité d’un représentant UE au sens de l’art. 27 du RGPD.',
  },
  de: {
    label: 'Juristische Prüfung erforderlich.',
    body: 'Verfasst für einen Privatverkauf aus der Schweiz. Lassen Sie den Text vor der Veröffentlichung von einer in der Schweiz tätigen Anwältin oder einem Anwalt prüfen — insbesondere, ob die Tätigkeit als gewerblich gilt und ob ein EU-Vertreter nach Art. 27 DSGVO nötig ist.',
  },
}

const FOOTER: Record<Locale, { updated: string; questions: string }> = {
  ru: { updated: 'Последнее обновление', questions: 'Вопросы' },
  en: { updated: 'Last updated', questions: 'Questions' },
  it: { updated: 'Ultimo aggiornamento', questions: 'Domande' },
  fr: { updated: 'Dernière mise à jour', questions: 'Questions' },
  de: { updated: 'Zuletzt aktualisiert', questions: 'Fragen' },
}

/**
 * The placeholders a lawyer must still resolve. Rendered visibly rather than
 * hidden in a comment: a TODO nobody sees is a TODO nobody does, and shipping
 * a policy that quietly omits the seller's legal identity is worse than one
 * that says so.
 */
export function DraftNotice() {
  const { locale } = useStore()
  const c = DRAFT[locale] ?? DRAFT.en
  return (
    <div className="not-prose mb-8 border-l-2 border-gold/50 bg-gold/[0.05] py-3 pl-4 pr-3">
      <p className="text-[12px] font-light leading-relaxed text-muted-foreground">
        <strong className="text-gold">{c.label}</strong> {c.body}
      </p>
    </div>
  )
}

export function Footer() {
  const { locale } = useStore()
  const c = FOOTER[locale] ?? FOOTER.en
  return (
    <p className="mt-12 border-t border-border/40 pt-6 text-[12px] text-muted-foreground/60">
      {c.updated}: {LAST_UPDATED[locale] ?? LAST_UPDATED.en}. {c.questions}:{' '}
      <a href={`mailto:${OPERATOR.support}`}>{OPERATOR.support}</a>
    </p>
  )
}
