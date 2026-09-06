'use client'

import { AUTHORITATIVE_LOCALE, resolveDoc, type Block, type LegalDocSet } from './types'
import { useStore } from '@/lib/store'

/**
 * Renders a legal document in the language the visitor has selected.
 *
 * Client component on purpose. The pages were previously server-rendered
 * Russian-only, so the header's language switcher had no effect on them —
 * choosing Italiano still produced Cyrillic. Reading `locale` from the store is
 * what makes the switch instant, with no route change and no reload.
 *
 * Next still server-renders this, so the initial HTML carries the default
 * locale and the page stays readable (and indexable) without JavaScript.
 */

/**
 * Inline markup: **bold** and [text](href), nothing else.
 *
 * Written as a parser rather than dangerouslySetInnerHTML precisely because
 * these strings are long-form prose that will be edited by non-programmers and
 * machine-translated. Allowing raw HTML through would make one careless
 * translation an XSS hole; here the worst case is a literal asterisk on screen.
 */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  // Alternation order matters: links first, so a bracket inside bold cannot
  // swallow the link syntax.
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      const href = m[2]
      // Only in-app paths and mailto: links appear in these documents; anything
      // else would be an authoring mistake, and rel/target guard against it.
      const external = !href.startsWith('/') && !href.startsWith('mailto:')
      out.push(
        <a
          key={`${keyPrefix}-a${i}`}
          href={href}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {m[1]}
        </a>,
      )
    } else {
      out.push(<strong key={`${keyPrefix}-b${i}`}>{m[3]}</strong>)
    }
    last = m.index + m[0].length
    i += 1
  }

  if (last < text.length) out.push(text.slice(last))
  return out
}

function renderBlock(block: Block, key: string): React.ReactNode {
  if ('p' in block) return <p key={key}>{renderInline(block.p, key)}</p>
  if ('ul' in block) {
    return (
      <ul key={key}>
        {block.ul.map((li, i) => (
          <li key={`${key}-${i}`}>{renderInline(li, `${key}-${i}`)}</li>
        ))}
      </ul>
    )
  }
  return (
    <ol key={key}>
      {block.ol.map((li, i) => (
        <li key={`${key}-${i}`}>{renderInline(li, `${key}-${i}`)}</li>
      ))}
    </ol>
  )
}

const FALLBACK_NOTICE: Record<string, string> = {
  ru: 'Этот документ пока не переведён на выбранный язык и показан на английском.',
  en: 'This document is not yet available in your selected language and is shown in English.',
  it: 'Questo documento non è ancora disponibile nella lingua selezionata ed è mostrato in inglese.',
  fr: 'Ce document n’est pas encore disponible dans la langue sélectionnée et s’affiche en anglais.',
  de: 'Dieses Dokument ist in der gewählten Sprache noch nicht verfügbar und wird auf Englisch angezeigt.',
}

const AUTHORITATIVE_NOTICE: Record<string, string> = {
  ru: 'Русская версия является основной. Переводы предоставлены для удобства.',
  en: 'The Russian version is authoritative. Translations are provided for convenience.',
  it: 'La versione russa fa fede. Le traduzioni sono fornite per comodità.',
  fr: 'La version russe fait foi. Les traductions sont fournies à titre indicatif.',
  de: 'Massgeblich ist die russische Fassung. Übersetzungen dienen der Bequemlichkeit.',
}

export function LegalDocument({ set }: { set: LegalDocSet }) {
  const { locale } = useStore()
  const { doc, isFallback } = resolveDoc(set, locale)

  return (
    <>
      <h1>{doc.title}</h1>
      <p className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground/60">
        {doc.effective}
      </p>

      {isFallback && (
        <div className="not-prose border-l-2 border-gold/40 bg-gold/[0.04] py-2.5 pl-4 pr-3">
          <p className="text-[12px] font-light text-muted-foreground">
            {FALLBACK_NOTICE[locale] ?? FALLBACK_NOTICE.en}
          </p>
        </div>
      )}

      {locale !== AUTHORITATIVE_LOCALE && !isFallback && (
        <p className="text-[11px] font-light italic text-muted-foreground/50">
          {AUTHORITATIVE_NOTICE[locale] ?? AUTHORITATIVE_NOTICE.en}
        </p>
      )}

      {doc.sections.map((section, si) => (
        <section key={si}>
          <h2>{section.h}</h2>
          {section.blocks.map((b, bi) => renderBlock(b, `s${si}-b${bi}`))}
        </section>
      ))}
    </>
  )
}
