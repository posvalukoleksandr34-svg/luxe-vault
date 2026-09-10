'use client'

import { Check, ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import {
  STYLIST_COLOR_LABELS,
  STYLIST_OCCASION_LABELS,
  STYLIST_STYLE_LABELS,
} from '@/lib/i18n'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { COLOR_FAMILIES, OCCASIONS, STYLES } from '@/lib/stylist/types'
import type { ColorFamily, StylistBrief } from '@/lib/stylist/types'

/**
 * The consultation.
 *
 * Six questions, one per screen, every one skippable — a stylist asks, they do
 * not interrogate. Deliberately NOT a chat transcript: a conversation UI makes
 * the customer compose sentences to buy a hoodie, where a set of large tappable
 * cards is faster on a phone and reads as a boutique rather than a helpdesk.
 *
 * The answers are held here and handed up as one brief; nothing is sent until
 * the last step, so going back and changing an answer costs nothing.
 */

// Option LABELS live in lib/i18n.ts (STYLIST_*_LABELS), keyed by the same
// system keys used below. The VALUES handed to the brief are always those
// keys — `occasion: 'everyday'`, never "На каждый день" — so the engine's
// matching is identical in every language.

/** Swatch colours are presentation, not copy, so they stay here. */
const COLOR_SWATCHES: Record<ColorFamily, string> = {
  black: '#141414',
  white: '#EFEBE3',
  grey: '#8A8A88',
  beige: '#CDBBA1',
  brown: '#6B4A32',
  navy: '#1E2A44',
  green: '#4A5B3C',
  red: '#7A2230',
  blue: '#3B5C82',
  pastel: '#D9C7D2',
  bright: '#D8A22B',
}

const BUDGETS = [150, 300, 500, 1000] as const
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const

const STEPS = ['occasion', 'style', 'colors', 'budget', 'sizes', 'notes'] as const
type Step = (typeof STEPS)[number]

export function Consultation({
  initial,
  onComplete,
}: {
  initial?: StylistBrief
  onComplete: (brief: StylistBrief) => void
}) {
  const { t, tf, localize } = useStore()
  const [index, setIndex] = useState(0)
  const [brief, setBrief] = useState<StylistBrief>(initial ?? {})

  const step: Step = STEPS[index]
  const last = index === STEPS.length - 1

  function advance(patch?: Partial<StylistBrief>) {
    const next = patch ? { ...brief, ...patch } : brief
    if (patch) setBrief(next)
    if (last) onComplete(next)
    else setIndex((i) => i + 1)
  }

  function toggleColor(c: ColorFamily) {
    const current = brief.colors ?? []
    const next = current.indexOf(c) !== -1 ? current.filter((x) => x !== c) : [...current, c]
    setBrief({ ...brief, colors: next.length ? next : undefined })
  }

  function toggleSize(s: string) {
    const current = brief.sizes ?? []
    const next = current.indexOf(s) !== -1 ? current.filter((x) => x !== s) : [...current, s]
    setBrief({ ...brief, sizes: next.length ? next : undefined })
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Progress. A rule that fills rather than a percentage — this is a
          consultation, not a form to be endured. */}
      <div className="mb-10 flex items-center gap-4">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="tap-safe flex items-center gap-1 text-[11px] uppercase tracking-[0.15em] text-muted-foreground/60 transition hover:text-foreground disabled:invisible"
        >
          <ChevronLeft className="size-3.5" />
          {t('stylist.back')}
        </button>
        <div className="h-px flex-1 bg-border/50">
          <div
            className="h-px bg-gold transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-[11px] uppercase tracking-[0.15em] text-muted-foreground/60">
          {t('stylist.step')} {index + 1}/{STEPS.length}
        </span>
      </div>

      <h2 className="mb-8 font-serif text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {t(`stylist.q.${step}` as Parameters<typeof t>[0])}
      </h2>

      {step === 'occasion' && (
        <Grid>
          {OCCASIONS.map((o) => (
            <Choice key={o} selected={brief.occasion === o} onClick={() => advance({ occasion: o })}>
              {localize(STYLIST_OCCASION_LABELS[o])}
            </Choice>
          ))}
        </Grid>
      )}

      {step === 'style' && (
        <Grid>
          {STYLES.map((s) => (
            <Choice key={s} selected={brief.style === s} onClick={() => advance({ style: s })}>
              {localize(STYLIST_STYLE_LABELS[s])}
            </Choice>
          ))}
        </Grid>
      )}

      {step === 'colors' && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {COLOR_FAMILIES.map((c) => {
            const on = (brief.colors ?? []).indexOf(c) !== -1
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleColor(c)}
                aria-pressed={on}
                className={cn(
                  // No `capitalize`: labels arrive correctly cased per
                  // locale, and title-casing "Bleu marine" or "Blu navy"
                  // would be wrong in French and Italian.
                  'flex min-h-[56px] items-center gap-3 border px-4 text-left text-[13px] transition-all duration-300',
                  on
                    ? 'border-gold/60 bg-gold/[0.06] text-foreground'
                    : 'border-border/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                )}
              >
                <span
                  className="size-5 shrink-0 border border-border/60"
                  style={{ backgroundColor: COLOR_SWATCHES[c] }}
                  aria-hidden
                />
                {localize(STYLIST_COLOR_LABELS[c])}
                {on && <Check className="ml-auto size-3.5 text-gold" />}
              </button>
            )
          })}
        </div>
      )}

      {step === 'budget' && (
        <Grid>
          {BUDGETS.map((b) => (
            <Choice key={b} selected={brief.budget === b} onClick={() => advance({ budget: b })}>
              {/* The shop's own price formatter, so budgets read exactly like
                  every other price on the site — not a second hand-rolled
                  'de-CH' format that could drift from it. */}
              {tf('stylist.budgetUpTo', { price: formatPrice(b) })}
            </Choice>
          ))}
          <Choice
            selected={brief.budget === undefined}
            onClick={() => advance({ budget: undefined })}
          >
            {t('stylist.anyBudget')}
          </Choice>
        </Grid>
      )}

      {step === 'sizes' && (
        <div className="flex flex-wrap gap-2.5">
          {SIZES.map((s) => {
            const on = (brief.sizes ?? []).indexOf(s) !== -1
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSize(s)}
                aria-pressed={on}
                className={cn(
                  'flex size-14 shrink-0 items-center justify-center border text-[13px] font-medium transition-all duration-300',
                  on
                    ? 'border-gold bg-gold text-gold-foreground'
                    : 'border-border/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground',
                )}
              >
                {s}
              </button>
            )
          })}
        </div>
      )}

      {step === 'notes' && (
        <textarea
          value={brief.notes ?? ''}
          onChange={(e) => setBrief({ ...brief, notes: e.target.value })}
          placeholder={t('stylist.notesPlaceholder')}
          rows={4}
          maxLength={300}
          className="w-full border border-border/60 bg-transparent p-4 text-[14px] font-light text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-gold"
        />
      )}

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => advance()}
          className="hero__cta group inline-flex items-center gap-2.5 border border-gold/30 px-8 py-3.5 text-[11px] uppercase tracking-[0.2em] text-foreground"
        >
          {last ? t('stylist.finish') : t('stylist.next')}
        </button>
        {!last && (
          <button
            type="button"
            onClick={() => advance()}
            className="tap-safe text-[11px] uppercase tracking-[0.15em] text-muted-foreground/50 transition hover:text-foreground"
          >
            {t('stylist.skip')}
          </button>
        )}
      </div>
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">{children}</div>
}

/** A choice card. 64px tall so it is comfortably tappable on a phone. */
function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex min-h-[64px] items-center justify-between gap-2 border px-4 text-left text-[13px] leading-tight transition-all duration-300',
        selected
          ? 'border-gold/60 bg-gold/[0.06] text-foreground'
          : 'border-border/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground',
      )}
    >
      {children}
      {selected && <Check className="size-3.5 shrink-0 text-gold" />}
    </button>
  )
}
