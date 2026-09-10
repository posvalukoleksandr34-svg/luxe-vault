'use client'

import { Ruler } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  WEIGHT_RANGE,
  fitToProduct,
  isLetterSizeRun,
  isValidFitInput,
  recommendSize,
  type FitPreference,
  type FitRecommendation,
  type ProductFit,
} from '@/lib/fit-advisor'
import { STYLIST_FIT_LABELS } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * "Find my size" — height, weight and fit preference in, a size out.
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
}: {
  /** The product's size run. */
  sizes: string[]
  /** Whether a size can be bought right now in the currently chosen colour. */
  isAvailable: (size: string) => boolean
  /** Selects the size on the product page. */
  onApply: (size: string) => void
}) {
  const { t, tf, localize } = useStore()
  const [open, setOpen] = useState(false)
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [preference, setPreference] = useState<FitPreference>('regular')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (saved && typeof saved === 'object') {
        if (typeof saved.height === 'string') setHeight(saved.height)
        if (typeof saved.weight === 'string') setWeight(saved.weight)
        if (PREFERENCES.indexOf(saved.preference) !== -1) setPreference(saved.preference)
      }
    } catch {
      // Storage unavailable (private mode, blocked) — start blank.
    }
  }, [])

  if (!isLetterSizeRun(sizes)) return null

  // Any change to the inputs invalidates a previous answer rather than leaving
  // a recommendation on screen that no longer matches what is typed.
  function edit(apply: () => void) {
    apply()
    setResult(null)
    setError(null)
  }

  function calculate() {
    // A comma decimal ("72,5") is how half this site's locales type numbers.
    const input = {
      heightCm: Number(height.replace(',', '.')),
      weightKg: Number(weight.replace(',', '.')),
      preference,
    }
    if (!isValidFitInput(input)) {
      setResult(null)
      setError(
        tf('fit.invalid', {
          hMin: HEIGHT_RANGE.min,
          hMax: HEIGHT_RANGE.max,
          wMin: WEIGHT_RANGE.min,
          wMax: WEIGHT_RANGE.max,
        }),
      )
      return
    }
    const rec = recommendSize(input)
    setResult({ rec, fit: fitToProduct(rec, sizes, isAvailable) })
    setError(null)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ height, weight, preference }))
    } catch {
      // Not remembering is fine.
    }
  }

  function apply(size: string) {
    onApply(size)
    setOpen(false)
  }

  const inputClass =
    'w-full border border-border bg-background px-3 py-2.5 text-[14px] tabular-nums text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-gold'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] text-gold/70 transition hover:text-gold"
        >
          <Ruler className="size-3" />
          {t('fit.cta')}
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-md border-gold/20 bg-popover">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl font-bold tracking-tight">
            <Ruler className="size-4 text-gold" />
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
              <span className="mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-foreground">
                {t('fit.height')}
              </span>
              <input
                inputMode="decimal"
                value={height}
                onChange={(e) => edit(() => setHeight(e.target.value))}
                placeholder="178"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-foreground">
                {t('fit.weight')}
              </span>
              <input
                inputMode="decimal"
                value={weight}
                onChange={(e) => edit(() => setWeight(e.target.value))}
                placeholder="72"
                className={inputClass}
              />
            </label>
          </div>

          <fieldset>
            <legend className="mb-2 text-[11px] uppercase tracking-[0.12em] text-foreground">
              {t('fit.preference')}
            </legend>
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
            <p role="alert" className="text-[12px] text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full border border-gold/40 bg-gold/5 px-5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
          >
            {t('fit.calculate')}
          </button>
        </form>

        {result && (
          <div role="status" className="border border-gold/30 bg-gold/[0.04] p-4">
            <p className="font-serif text-lg font-bold text-foreground">
              {tf('fit.recommended', { size: result.rec.size })}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {t('fit.basedOn')} · {t(`fit.confidence.${result.rec.confidence}` as Parameters<typeof t>[0])}
            </p>

            {result.fit.kind === 'not_carried' && (
              <p className="mt-3 text-[12px] font-light text-muted-foreground">
                {tf('fit.notCarried', { ideal: result.fit.ideal, size: result.fit.size })}
              </p>
            )}
            {result.fit.kind === 'sold_out' && (
              <p className="mt-3 text-[12px] font-light text-muted-foreground">
                {tf('fit.soldOut', { ideal: result.fit.ideal, size: result.fit.size })}
              </p>
            )}
            {result.fit.kind === 'none' && (
              <p className="mt-3 text-[12px] font-light text-destructive/80">{t('fit.none')}</p>
            )}

            {result.fit.kind !== 'none' && (
              <button
                type="button"
                onClick={() => apply((result.fit as { size: string }).size)}
                className="mt-4 w-full border border-gold bg-gold px-5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold-foreground transition-opacity duration-300 hover:opacity-90"
              >
                {tf('fit.apply', { size: result.fit.size })}
              </button>
            )}
          </div>
        )}

        <p className="text-[11px] font-light leading-relaxed text-muted-foreground/70">
          {t('fit.disclaimer')}
        </p>
      </DialogContent>
    </Dialog>
  )
}
