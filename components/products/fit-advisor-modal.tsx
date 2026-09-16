'use client'

import { Ruler } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  HEIGHT_RANGE,
  LETTER_SIZES,
  WEIGHT_RANGE,
  checkFitInput,
  fitToProduct,
  indexOfSize,
  isLetterSizeRun,
  recommendSize,
  type FitPreference,
  type FitRecommendation,
  type LetterSize,
  type ProductFit,
} from '@/lib/fit-advisor'
import { STYLIST_FIT_LABELS } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import type { SizeMeasurement } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * "Find my size" — a usual size and/or height and weight, a preferred fit,
 * and this product's own cut in; a size this product can actually sell out.
 *
 * Presentation only. The rule lives in lib/fit-advisor.ts, so it can be read
 * and tuned without touching this file.
 *
 * Renders NOTHING for a product not sold in letter sizes: a height-and-weight
 * table says nothing about shoe sizes or a one-size cap, and a confident
 * wrong answer there would be worse than no button.
 */

const PREFERENCES: FitPreference[] = ['slim', 'regular', 'oversized']

/** Inputs are remembered on this device so the next product does not ask
 *  again. Local only — body measurements have no business on a server. */
const STORAGE_KEY = 'lv.fit.v1'

type Result = { rec: FitRecommendation; fit: ProductFit }

export function FitAdvisorModal({
  sizes,
  isAvailable,
  onApply,
  productCut,
  sizeChart,
}: {
  /** The product's size run. */
  sizes: string[]
  /** Whether a size can be bought right now in the currently chosen colour. */
  isAvailable: (size: string) => boolean
  /** Selects the size on the product page. */
  onApply: (size: string) => void
  /** How this product is cut, when known. */
  productCut?: FitPreference
  /** This product's own measurements, per size. Never a shared default. */
  sizeChart?: SizeMeasurement[]
}) {
  const { t, tf, localize } = useStore()
  const [open, setOpen] = useState(false)
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [usual, setUsual] = useState<LetterSize | null>(null)
  const [preference, setPreference] = useState<FitPreference>('regular')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const heightRef = useRef<HTMLInputElement>(null)
  const weightRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (saved && typeof saved === 'object') {
        if (typeof saved.height === 'string') setHeight(saved.height)
        if (typeof saved.weight === 'string') setWeight(saved.weight)
        if ((LETTER_SIZES as readonly string[]).indexOf(saved.usual) !== -1) setUsual(saved.usual)
        if (PREFERENCES.indexOf(saved.preference) !== -1) setPreference(saved.preference)
      }
    } catch {
      // Storage unavailable (private mode, blocked) — start blank.
    }
  }, [])

  if (!isLetterSizeRun(sizes)) return null

  const hasChart = Boolean(sizeChart?.length)

  // Any change to the inputs invalidates a previous answer rather than leaving
  // a recommendation on screen that no longer matches what is typed.
  function edit(apply: () => void) {
    apply()
    setResult(null)
    setError(null)
  }

  function calculate() {
    // A comma decimal ("72,5") is how half this site's locales type numbers.
    const num = (v: string) => (v.trim() ? Number(v.trim().replace(',', '.')) : undefined)
    const input = {
      heightCm: num(height),
      weightKg: num(weight),
      usualSize: usual ?? undefined,
      preference,
      productCut,
    }
    const check = checkFitInput(input)
    if (check !== 'ok') {
      setResult(null)
      setError(
        check === 'missing'
          ? t('fit.needInput')
          : tf('fit.invalid', {
              hMin: HEIGHT_RANGE.min,
              hMax: HEIGHT_RANGE.max,
              wMin: WEIGHT_RANGE.min,
              wMax: WEIGHT_RANGE.max,
            }),
      )
      // Straight to the field to fix: an empty or out-of-range height first,
      // otherwise the weight.
      const h = input.heightCm
      const heightFirst = h === undefined || h < HEIGHT_RANGE.min || h > HEIGHT_RANGE.max
      ;(heightFirst ? heightRef : weightRef).current?.focus()
      return
    }
    let rec = recommendSize(input)
    // Without this product's own measurements the answer rests on standard
    // sizing alone — never present that as certain.
    if (!hasChart && rec.confidence === 'high') rec = { ...rec, confidence: 'medium' }
    setResult({ rec, fit: fitToProduct(rec, sizes, isAvailable) })
    setError(null)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ height, weight, usual, preference }))
    } catch {
      // Not remembering is fine.
    }
  }

  function apply(size: string) {
    onApply(size)
    setOpen(false)
  }

  // The size the shopper can actually select, and its real measurements.
  const selectable = result && result.fit.kind !== 'none' ? result.fit.size : null
  // The ideal size as THIS product writes it ("2XL" rather than "XXL").
  const idealName = result
    ? sizes.find((s) => indexOfSize(s) === indexOfSize(result.rec.size)) ?? result.rec.size
    : ''
  const row = selectable
    ? sizeChart?.find((r) => r.size.trim().toUpperCase() === selectable.trim().toUpperCase())
    : undefined
  const cm = t('sizeGuide.cm')
  const measures = row
    ? [
        // A non-breaking space keeps "112 cm" on one line.
        row.chest ? `${t('sizeGuide.chest')} ${row.chest} ${cm}` : '',
        row.length ? `${t('sizeGuide.length')} ${row.length} ${cm}` : '',
        row.shoulder ? `${t('sizeGuide.shoulder')} ${row.shoulder} ${cm}` : '',
        row.sleeve ? `${t('sizeGuide.sleeve')} ${row.sleeve} ${cm}` : '',
      ].filter(Boolean)
    : []

  const inputClass =
    'w-full border border-border bg-background px-3 py-2.5 text-[14px] tabular-nums text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-gold'
  const labelClass = 'mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-foreground'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] text-gold/70 transition hover:text-gold"
        >
          <Ruler aria-hidden className="size-3" />
          {t('fit.cta')}
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto overscroll-contain border-gold/20 bg-popover">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl font-bold tracking-tight">
            <Ruler aria-hidden className="size-4 text-gold" />
            {t('fit.title')}
          </DialogTitle>
          <DialogDescription className="text-[13px] font-light leading-relaxed">
            {t('fit.lead')}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            calculate()
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>{t('fit.height')}</span>
              <input
                ref={heightRef}
                id="fit-height"
                name="height"
                autoComplete="off"
                inputMode="decimal"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'fit-error' : undefined}
                value={height}
                onChange={(e) => edit(() => setHeight(e.target.value))}
                placeholder="178"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>{t('fit.weight')}</span>
              <input
                ref={weightRef}
                id="fit-weight"
                name="weight"
                autoComplete="off"
                inputMode="decimal"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'fit-error' : undefined}
                value={weight}
                onChange={(e) => edit(() => setWeight(e.target.value))}
                placeholder="72"
                className={inputClass}
              />
            </label>
          </div>

          {/* Optional, and enough on its own: the quickest way in for someone
              who knows they wear an M. Tap again to clear. */}
          <fieldset>
            <legend className={labelClass}>
              {t('fit.usual')}{' '}
              <span className="normal-case tracking-normal text-muted-foreground/80">· {t('fit.optional')}</span>
            </legend>
            <div className="grid grid-cols-7 gap-1">
              {LETTER_SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => edit(() => setUsual(usual === s ? null : s))}
                  aria-pressed={usual === s}
                  className={cn(
                    'min-h-[40px] border text-[12px] transition-colors duration-200',
                    usual === s
                      ? 'border-gold bg-gold/5 text-gold'
                      : 'border-border text-foreground/70 hover:border-foreground/30 hover:text-foreground',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={labelClass}>{t('fit.preference')}</legend>
            {/* The same labels the stylist uses for fit, so "Оверсайз" means one
                thing across the whole shop. */}
            <div className="grid grid-cols-3 gap-2">
              {PREFERENCES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => edit(() => setPreference(p))}
                  aria-pressed={preference === p}
                  className={cn(
                    'min-h-[44px] border px-2 text-[12px] leading-tight transition-colors duration-200',
                    preference === p
                      ? 'border-gold bg-gold/5 text-gold'
                      : 'border-border text-foreground/70 hover:border-foreground/30 hover:text-foreground',
                  )}
                >
                  {localize(STYLIST_FIT_LABELS[p])}
                </button>
              ))}
            </div>
          </fieldset>

          {error && (
            <p id="fit-error" role="alert" className="text-[12px] text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full border border-gold/40 bg-gold/5 px-5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-colors duration-300 hover:bg-gold hover:text-gold-foreground"
          >
            {t('fit.calculate')}
          </button>
        </form>

        {result && (
          <div role="status" className="border border-gold/30 bg-gold/[0.04] p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t('fit.recommendedLabel')}
            </p>
            <p className="mt-1.5 font-serif text-5xl font-bold leading-none text-gold">{idealName}</p>
            {result.fit.kind === 'exact' && (
              <p className="mt-3 text-[13px] font-light leading-relaxed text-foreground/90">
                {tf('fit.closest', { size: result.fit.size })}
              </p>
            )}
            <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {t('fit.basedOn')} · {t(`fit.confidence.${result.rec.confidence}` as Parameters<typeof t>[0])}
            </p>

            {result.fit.kind === 'not_carried' && (
              <p className="mt-3 text-[12px] font-light text-muted-foreground">
                {tf('fit.notCarried', { ideal: idealName, size: result.fit.size })}
              </p>
            )}
            {result.fit.kind === 'sold_out' && (
              <p className="mt-3 text-[12px] font-light text-muted-foreground">
                {tf('fit.soldOut', { ideal: idealName, size: result.fit.size })}
              </p>
            )}
            {result.fit.kind === 'none' && (
              <p className="mt-3 text-[12px] font-light text-destructive/80">{t('fit.none')}</p>
            )}

            {productCut && productCut !== 'regular' && (
              <p className="mt-3 text-[12px] font-light text-muted-foreground">
                {tf('fit.cutNote', { cut: localize(STYLIST_FIT_LABELS[productCut]).toLowerCase() })}
              </p>
            )}

            {selectable && measures.length > 0 && (
              <p className="mt-3 border-t border-gold/15 pt-3 text-[12px] font-light leading-relaxed text-muted-foreground">
                <span className="text-foreground/80">{tf('fit.measurements', { size: selectable })}:</span>{' '}
                {measures.join(' · ')}
              </p>
            )}
            {!hasChart && (
              <p className="mt-3 border-t border-gold/15 pt-3 text-[12px] font-light leading-relaxed text-muted-foreground">
                {t('fit.noChart')}
              </p>
            )}

            {selectable && (
              <button
                type="button"
                onClick={() => apply(selectable)}
                className="mt-4 w-full border border-gold bg-gold px-5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold-foreground transition-opacity duration-300 hover:opacity-90"
              >
                {tf('fit.apply', { size: selectable })}
              </button>
            )}
          </div>
        )}

        <p className="text-[11px] font-light leading-relaxed text-muted-foreground/80">
          {t('fit.disclaimer')}
        </p>
      </DialogContent>
    </Dialog>
  )
}
