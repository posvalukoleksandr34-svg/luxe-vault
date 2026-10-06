'use client'

import { ChevronLeft, ChevronRight, Check, Info, Ruler } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from '@/components/locale-link'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  AGE_RANGE,
  HEIGHT_RANGE,
  WEIGHT_RANGE,
  finderRecommendation,
  isLetterSizeRun,
  type FinderResult,
  type FitPreference,
  type ShapeLevel,
} from '@/lib/fit-advisor'
import { productImage } from '@/lib/product-image'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { AbdomenFigure, HipsFigure } from './body-shape'

/**
 * "Trova la tua misura" — the step-by-step size finder on the product page.
 *
 *   1 height and weight (cm or ft/in, kg or lb)   4 abdomen
 *   2 age (optional)                               5 preferred fit, on a slider
 *   3 hips                                         6 the size, with a match % per size
 *
 * The rule is lib/fit-advisor.ts (finderRecommendation), the same tables as
 * before: height and weight lead, the rest move the answer by fractions, and
 * the answer is fitted onto the sizes this product makes and has in stock in
 * the colour chosen. It never recommends a size the shopper cannot buy, nor
 * one that is unlikely to be theirs: then the answer is "no size found", with
 * the reason and a way to ask us.
 *
 * PRIVACY. Everything is computed in the browser. The answers are remembered
 * on this device only (localStorage) so the next product does not ask again,
 * and "Start over" forgets them. Nothing is sent to the server.
 *
 * Shown for letter-sized adult clothing (XS…XXXL). Shoes keep the
 * foot-length finder (fit-advisor-modal.tsx); kids' pieces get none — the
 * table is for adults.
 */

type Step = 'body' | 'age' | 'hips' | 'belly' | 'fit' | 'result'
const STEPS: Step[] = ['body', 'age', 'hips', 'belly', 'fit', 'result']
const QUESTIONS = STEPS.length - 1

const STORAGE_KEY = 'lv.finder.v1'
const CM_PER_IN = 2.54
const KG_PER_LB = 0.45359237
const SHAPES: ShapeLevel[] = [-1, 0, 1]

type Saved = {
  lengthUnit: 'cm' | 'ftin'
  massUnit: 'kg' | 'lb'
  cm: string
  ft: string
  inch: string
  kg: string
  lb: string
  age: string
  ageSkipped: boolean
  hips: ShapeLevel
  belly: ShapeLevel
  fitStop: number
}

const EMPTY: Saved = {
  lengthUnit: 'cm',
  massUnit: 'kg',
  cm: '',
  ft: '',
  inch: '',
  kg: '',
  lb: '',
  age: '',
  ageSkipped: false,
  hips: 0,
  belly: 0,
  fitStop: 0,
}

/** "72,5" is how half this site's locales type a decimal. */
function num(v: string): number | undefined {
  const t = v.trim().replace(',', '.')
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

function readSaved(): Saved | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return null
    const shape = (v: unknown): ShapeLevel => (v === -1 || v === 1 ? v : 0)
    const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 6) : '')
    return {
      lengthUnit: raw.lengthUnit === 'ftin' ? 'ftin' : 'cm',
      massUnit: raw.massUnit === 'lb' ? 'lb' : 'kg',
      cm: str(raw.cm),
      ft: str(raw.ft),
      inch: str(raw.inch),
      kg: str(raw.kg),
      lb: str(raw.lb),
      age: str(raw.age),
      ageSkipped: raw.ageSkipped === true,
      hips: shape(raw.hips),
      belly: shape(raw.belly),
      fitStop: [-2, -1, 0, 1, 2].includes(raw.fitStop) ? raw.fitStop : 0,
    }
  } catch {
    return null
  }
}

export function SizeFinder({
  sizes,
  isAvailable,
  onApply,
  productCut,
  image,
  name,
  kind,
  group,
  onOpenSizeChart,
}: {
  sizes: string[]
  /** Buyable now, in the colour chosen. */
  isAvailable: (size: string) => boolean
  /** Selects the size on the product page. */
  onApply: (size: string) => void
  productCut?: FitPreference
  /** The product photo for the left panel (the chosen colour's). */
  image?: string
  name: string
  kind: 'tops' | 'bottoms'
  group?: string
  onOpenSizeChart?: () => void
}) {
  const { t, tf } = useStore()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('body')
  const [a, setA] = useState<Saved>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [privacy, setPrivacy] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Each new step is announced and keyboard focus starts at its heading.
  useEffect(() => {
    if (open) headingRef.current?.focus()
  }, [step, open])

  const index = STEPS.indexOf(step)
  const set = (patch: Partial<Saved>) => {
    setA((prev) => ({ ...prev, ...patch }))
    setError(null)
  }

  const heightCm = a.lengthUnit === 'cm' ? num(a.cm) : (() => {
    const ft = num(a.ft)
    const inch = num(a.inch) ?? 0
    return ft === undefined ? undefined : ft * 12 * CM_PER_IN + inch * CM_PER_IN
  })()
  const weightKg = a.massUnit === 'kg' ? num(a.kg) : (() => {
    const lb = num(a.lb)
    return lb === undefined ? undefined : lb * KG_PER_LB
  })()
  const age = a.ageSkipped ? undefined : num(a.age)

  const bodyFilled = heightCm !== undefined && weightKg !== undefined
  const ageValid = age !== undefined && age >= AGE_RANGE.min && age <= AGE_RANGE.max

  const result = useMemo(() => {
    if (step !== 'result' || heightCm === undefined || weightKg === undefined) return null
    return finderRecommendation(
      {
        heightCm,
        weightKg,
        age,
        hips: a.hips,
        abdomen: a.belly,
        fit: a.fitStop / 2,
        productCut,
        kind,
      },
      sizes,
      isAvailable,
    )
  }, [step, heightCm, weightKg, age, a.hips, a.belly, a.fitStop, productCut, kind, sizes, isAvailable])

  // Remembered on this device once there is an answer to remember.
  useEffect(() => {
    if (step !== 'result') return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(a))
    } catch {
      // Storage unavailable: the finder simply asks again next time.
    }
  }, [step, a])

  // Not offered: anything but letter sizes, and children's pieces.
  if (!isLetterSizeRun(sizes) || group === 'kids') return null

  function openFinder(next: boolean) {
    setOpen(next)
    if (next) {
      // Answers from an earlier product, on this device: filled in, from step 1.
      setA(readSaved() ?? EMPTY)
      setStep('body')
      setError(null)
      setPrivacy(false)
    }
  }

  function go(to: Step) {
    setError(null)
    setStep(to)
  }

  function next(e?: FormEvent) {
    e?.preventDefault()
    if (step === 'body') {
      if (
        heightCm === undefined ||
        weightKg === undefined ||
        heightCm < HEIGHT_RANGE.min ||
        heightCm > HEIGHT_RANGE.max ||
        weightKg < WEIGHT_RANGE.min ||
        weightKg > WEIGHT_RANGE.max
      ) {
        setError(tf('fit.invalid', { hMin: HEIGHT_RANGE.min, hMax: HEIGHT_RANGE.max, wMin: WEIGHT_RANGE.min, wMax: WEIGHT_RANGE.max }))
        return
      }
    }
    if (step === 'age' && !a.ageSkipped && !ageValid) {
      setError(tf('finder.age.invalid', { min: AGE_RANGE.min, max: AGE_RANGE.max }))
      return
    }
    go(STEPS[Math.min(STEPS.length - 1, index + 1)])
  }

  function restart() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // nothing to forget
    }
    setA(EMPTY)
    go('body')
  }

  const remaining = QUESTIONS - index
  const progressText =
    step === 'result' ? t('finder.leftDone') : remaining <= 1 ? t('finder.leftOne') : tf('finder.left', { n: remaining })
  const canContinue =
    step === 'body' ? bodyFilled : step === 'age' ? a.ageSkipped || (a.age.trim() !== '') : true

  return (
    <Dialog open={open} onOpenChange={openFinder}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="tap-safe inline-flex items-center gap-1.5 rounded-full border border-gold/45 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-gold transition hover:border-gold hover:bg-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          <Ruler aria-hidden className="size-3.5" strokeWidth={1.5} />
          {t('finder.open')}
        </button>
      </DialogTrigger>

      <DialogContent
        className={cn(
          'flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0',
          'md:grid md:h-[600px] md:max-h-[92vh] md:w-[min(900px,94vw)] md:grid-cols-[300px_1fr] md:rounded-2xl md:border md:border-border',
        )}
      >
        <DialogTitle className="sr-only">{t('finder.open')}</DialogTitle>
        <DialogDescription className="sr-only">{tf('finder.step', { n: index + 1, total: STEPS.length })}</DialogDescription>

        {/* ---------------------------------------------------- left panel -- */}
        <aside className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-secondary px-4 py-3 md:flex-col md:items-stretch md:gap-5 md:border-b-0 md:border-r md:p-6">
          {/* From md the photo takes whatever height the column has left; an
              aspect-ratio alone collapses inside this flex column. */}
          <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-background md:size-auto md:min-h-0 md:w-full md:flex-1 md:shrink md:rounded-xl">
            <Image src={productImage(image)} alt={name} fill sizes="(min-width: 768px) 252px, 56px" className="object-cover" />
          </div>
          <div
            aria-live="polite"
            className="min-w-0 flex-1 md:flex md:min-h-[132px] md:flex-none md:items-center md:rounded-xl md:bg-background md:px-5 md:py-4"
          >
            <p className="truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground md:hidden">{name}</p>
            <p className="text-[13px] leading-relaxed text-foreground/80">{privacy ? t('finder.privacyNote') : progressText}</p>
          </div>
          <button
            type="button"
            onClick={() => setPrivacy((v) => !v)}
            aria-pressed={privacy}
            className="hidden shrink-0 items-center justify-center gap-1.5 text-[12px] text-foreground/75 underline underline-offset-4 transition hover:text-foreground md:flex"
          >
            <Info aria-hidden className="size-3.5" />
            {t('finder.privacy')}
          </button>
        </aside>

        {/* --------------------------------------------------- right panel -- */}
        <form onSubmit={next} noValidate className="relative flex min-h-0 flex-1 flex-col">
          <div className="h-0.5 w-full bg-border/60" aria-hidden>
            <div className="h-0.5 bg-gold transition-all duration-500" style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4 pt-7 sm:px-8 md:px-10 md:pt-10">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="pr-8 text-[13px] font-semibold uppercase tracking-[0.16em] text-foreground outline-none"
            >
              {step === 'body' && t('finder.body.title')}
              {step === 'age' && t('finder.age.title')}
              {step === 'hips' && t('finder.hips.title')}
              {step === 'belly' && t('finder.belly.title')}
              {step === 'fit' && t('finder.fit.title')}
              {step === 'result' &&
                (result?.fit.kind === 'none' && result.fit.reason !== 'sold_out' ? t('finder.none.title') : t('finder.result.title'))}
            </h2>

            <div className="mt-6 flex-1">
              {step === 'body' && <BodyStep a={a} set={set} />}
              {step === 'age' && <AgeStep a={a} set={set} onSkip={() => { set({ ageSkipped: true, age: '' }); go('hips') }} />}
              {step === 'hips' && <ShapeStep kind="hips" value={a.hips} onChange={(hips) => set({ hips })} />}
              {step === 'belly' && <ShapeStep kind="belly" value={a.belly} onChange={(belly) => set({ belly })} />}
              {step === 'fit' && <FitStep stop={a.fitStop} onChange={(fitStop) => set({ fitStop })} />}
              {step === 'result' && result && <ResultStep result={result} onOpenSizeChart={onOpenSizeChart ? () => { setOpen(false); onOpenSizeChart() } : undefined} />}

              {error && (
                <p role="alert" className="mt-4 text-[12px] text-destructive">
                  {error}
                </p>
              )}
            </div>
          </div>

          {/* Footer: one primary action, the way back under it. */}
          <div className="flex shrink-0 flex-col items-center gap-3 border-t border-border/50 px-5 py-4 sm:px-8 md:border-t-0 md:pb-8">
            {step !== 'result' ? (
              <button type="submit" disabled={!canContinue} className={PRIMARY}>
                {t('finder.continue')}
              </button>
            ) : result && result.fit.kind !== 'none' ? (
              <button
                type="button"
                className={PRIMARY}
                onClick={() => {
                  if (result.fit.kind !== 'none') onApply(result.fit.size)
                  setOpen(false)
                }}
              >
                {tf('finder.result.select', { size: result.fit.size })}
              </button>
            ) : (
              <button type="button" className={PRIMARY} onClick={() => setOpen(false)}>
                {t('finder.result.continue')}
              </button>
            )}

            {step === 'result' ? (
              <button type="button" onClick={restart} className="text-[12px] text-foreground/80 underline underline-offset-4 hover:text-foreground">
                {t('finder.result.restart')}
              </button>
            ) : index > 0 ? (
              <button
                type="button"
                onClick={() => go(STEPS[index - 1])}
                className="inline-flex items-center gap-1 text-[12px] text-foreground/80 transition hover:text-foreground"
              >
                <ChevronLeft aria-hidden className="size-4" />
                {t('finder.back')}
              </button>
            ) : (
              <span className="h-[18px]" aria-hidden />
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const PRIMARY =
  'min-h-12 w-full max-w-sm rounded-xl bg-foreground px-6 py-3 text-[12px] font-semibold uppercase leading-snug tracking-[0.12em] text-background transition sm:tracking-[0.2em] [@media(hover:hover)]:hover:text-[hsl(var(--gold-light))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-foreground/15 disabled:text-background'

const FIELD =
  'h-14 w-full rounded-xl border border-border bg-card px-4 text-[18px] tabular-nums text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-gold focus:ring-1 focus:ring-gold/40'

/** Two-way unit switch: cm | ft·in, kg | lb. Toggle buttons in a labelled
 *  group: each says whether it is the unit in use (aria-pressed). */
function UnitToggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.1em] transition',
            value === o.value ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function BodyStep({ a, set }: { a: Saved; set: (p: Partial<Saved>) => void }) {
  const { t } = useStore()
  return (
    <div className="max-w-md space-y-7">
      <div>
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <label htmlFor={a.lengthUnit === 'cm' ? 'finder-cm' : 'finder-ft'} className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('finder.height')}
          </label>
          <UnitToggle
            label={t('finder.height')}
            value={a.lengthUnit}
            options={[{ value: 'cm', label: 'cm' }, { value: 'ftin', label: 'ft · in' }]}
            onChange={(lengthUnit) => set({ lengthUnit })}
          />
        </div>
        {a.lengthUnit === 'cm' ? (
          <div className="relative">
            <input id="finder-cm" inputMode="decimal" autoComplete="off" className={FIELD} value={a.cm} onChange={(e) => set({ cm: e.target.value })} placeholder="170" />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">cm</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <input id="finder-ft" inputMode="numeric" autoComplete="off" aria-label={`${t('finder.height')} (ft)`} className={FIELD} value={a.ft} onChange={(e) => set({ ft: e.target.value })} placeholder="5" />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">ft</span>
            </div>
            <div className="relative">
              <input inputMode="decimal" autoComplete="off" aria-label={`${t('finder.height')} (in)`} className={FIELD} value={a.inch} onChange={(e) => set({ inch: e.target.value })} placeholder="7" />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">in</span>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <label htmlFor="finder-mass" className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('finder.weight')}
          </label>
          <UnitToggle
            label={t('finder.weight')}
            value={a.massUnit}
            options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
            onChange={(massUnit) => set({ massUnit })}
          />
        </div>
        <div className="relative">
          <input
            id="finder-mass"
            inputMode="decimal"
            autoComplete="off"
            className={FIELD}
            value={a.massUnit === 'kg' ? a.kg : a.lb}
            onChange={(e) => set(a.massUnit === 'kg' ? { kg: e.target.value } : { lb: e.target.value })}
            placeholder={a.massUnit === 'kg' ? '62' : '137'}
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">{a.massUnit}</span>
        </div>
      </div>
    </div>
  )
}

function AgeStep({ a, set, onSkip }: { a: Saved; set: (p: Partial<Saved>) => void; onSkip: () => void }) {
  const { t } = useStore()
  return (
    <div className="max-w-md">
      <label htmlFor="finder-age" className="sr-only">
        {t('finder.age.label')}
      </label>
      <input
        id="finder-age"
        inputMode="numeric"
        autoComplete="off"
        className={cn(FIELD, 'max-w-[240px]')}
        value={a.age}
        onChange={(e) => set({ age: e.target.value, ageSkipped: false })}
        placeholder={t('finder.age.label')}
      />
      <p className="mt-5 max-w-sm text-[13px] leading-relaxed text-foreground/75">{t('finder.age.why')}</p>
      <button type="button" onClick={onSkip} className="mt-4 text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground">
        {t('finder.age.skip')}
      </button>
    </div>
  )
}

function ShapeStep({ kind, value, onChange }: { kind: 'hips' | 'belly'; value: ShapeLevel; onChange: (v: ShapeLevel) => void }) {
  const { t } = useStore()
  const i = SHAPES.indexOf(value)
  const label = (v: ShapeLevel) => t(`finder.${kind}.${v}` as Parameters<typeof t>[0])
  const radios = useRef<(HTMLButtonElement | null)[]>([])
  const move = (delta: number, focus = false) => {
    const to = Math.max(0, Math.min(SHAPES.length - 1, i + delta))
    onChange(SHAPES[to])
    // Arrow keys move the focus with the choice (the radio-group pattern):
    // the radio left behind is no longer in the tab order.
    if (focus) radios.current[to]?.focus()
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      move(1, true)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1, true)
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div className="flex w-full items-center justify-center gap-2 sm:gap-6">
        <button type="button" onClick={() => move(-1)} disabled={i === 0} aria-label={t('finder.shapePrev')} className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-25">
          <ChevronLeft className="size-5" />
        </button>
        <div className="flex h-[190px] items-center justify-center sm:h-[220px]">
          {kind === 'hips' ? <HipsFigure level={value} /> : <AbdomenFigure level={value} />}
        </div>
        <button type="button" onClick={() => move(1)} disabled={i === SHAPES.length - 1} aria-label={t('finder.shapeNext')} className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-25">
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div role="radiogroup" aria-label={t(kind === 'hips' ? 'finder.hips.title' : 'finder.belly.title')} onKeyDown={onKey} className="mt-6 grid w-full max-w-md grid-cols-3 gap-2">
        {SHAPES.map((v, n) => {
          const on = v === value
          return (
            <button
              key={v}
              ref={(el) => {
                radios.current[n] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(v)}
              className="group flex flex-col items-center gap-2 rounded-xl py-2 outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            >
              <span
                className={cn(
                  'flex size-11 items-center justify-center rounded-full border transition',
                  on ? 'border-foreground bg-foreground text-background' : 'border-foreground/30 bg-card group-hover:border-foreground/60',
                )}
              >
                {on && <Check aria-hidden className="size-5" strokeWidth={2} />}
              </span>
              <span className={cn('text-center text-[13px]', on ? 'text-foreground' : 'text-foreground/70')}>{label(v)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const FIT_STOPS = [-2, -1, 0, 1, 2] as const

function FitStep({ stop, onChange }: { stop: number; onChange: (v: number) => void }) {
  const { t } = useStore()
  const label = (s: number) => t(`finder.fit.${s}` as Parameters<typeof t>[0])
  const pct = ((stop + 2) / 4) * 100
  return (
    <div className="max-w-lg">
      <p className="text-[14px] text-foreground/80">{t('finder.fit.question')}</p>
      <div className="relative mt-20 px-1">
        {/* The value, above the thumb, as on the reference. */}
        <span
          aria-hidden
          className="absolute -top-11 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-background after:absolute after:left-1/2 after:top-full after:-translate-x-1/2 after:border-[5px] after:border-transparent after:border-t-foreground"
          style={{ left: `calc(${pct}% + ${(0.5 - pct / 100) * 28}px)` }}
        >
          {label(stop)}
        </span>
        <input
          type="range"
          min={-2}
          max={2}
          step={1}
          value={stop}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={t('finder.fit.title')}
          aria-valuetext={label(stop)}
          className="finder-range"
        />
        <div className="mt-1 flex justify-between px-[11px]" aria-hidden>
          {FIT_STOPS.map((s) => (
            <span key={s} className={cn('size-1.5 rounded-full', s === stop ? 'bg-gold' : 'bg-foreground/25')} />
          ))}
        </div>
      </div>
      <div className="mt-4 flex justify-between text-[12px] text-muted-foreground">
        <button type="button" onClick={() => onChange(Math.max(-2, stop - 1))} className="hover:text-foreground">
          « {label(-2)}
        </button>
        <button type="button" onClick={() => onChange(Math.min(2, stop + 1))} className="hover:text-foreground">
          {label(2)} »
        </button>
      </div>
    </div>
  )
}

function ResultStep({ result, onOpenSizeChart }: { result: FinderResult; onOpenSizeChart?: () => void }) {
  const { t, tf } = useStore()
  const { fit } = result
  const picked = fit.kind === 'none' ? null : fit.size
  // In large type: the size offered, or — when this piece is made in the
  // shopper's size but it is sold out in this colour — that size, marked so.
  const headline = picked ?? (fit.kind === 'none' && fit.reason === 'sold_out' ? fit.ideal : null)
  const shares = result.shares.filter((s) => s.percent > 0).slice(0, 3)

  const message =
    fit.kind === 'exact'
      ? t(`finder.result.${result.rec.confidence}` as Parameters<typeof t>[0])
      : fit.kind === 'sold_out'
        ? tf('fit.soldOut', { ideal: fit.ideal, size: fit.size })
        : fit.kind === 'not_carried'
          ? tf('fit.notCarried', { ideal: fit.ideal, size: fit.size })
          : fit.reason === 'sold_out'
            ? tf('finder.none.soldOut', { size: fit.ideal })
            : fit.reason === 'not_carried'
              ? tf('finder.none.notCarried', { size: fit.ideal })
              : t('finder.none.body')

  return (
    <div className="max-w-md">
      {headline && (
        <div className="mb-7 flex items-end gap-4">
          <span className={cn('font-serif text-[64px] font-semibold leading-none', picked ? 'text-foreground' : 'text-foreground/60')}>
            {headline}
          </span>
          <span className={cn('pb-2 text-[11px] uppercase tracking-[0.14em]', picked ? 'text-gold' : 'text-muted-foreground')}>
            {picked ? t('finder.result.for') : t('finder.result.soldOutTag')}
          </span>
        </div>
      )}

      {/* The chance that each size is theirs. When nothing fits these bars
          stay short — that, not a full bar under "no size found", is the
          honest picture. */}
      {shares.length > 0 && (
        <>
          <p className="mb-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('finder.result.shares')}</p>
          <ul className="space-y-4">
            {shares.map((s) => (
              <li key={s.size}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="font-semibold text-foreground">
                    {s.size}
                    {!s.available && (
                      <span className="ml-2 text-[10px] font-normal uppercase tracking-[0.12em] text-muted-foreground">
                        {t('finder.result.soldOutTag')}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-foreground/80">{s.percent}%</span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-border/70"
                  role="meter"
                  aria-label={s.available ? s.size : `${s.size}, ${t('finder.result.soldOutTag')}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={s.percent}
                >
                  <div
                    className={cn(
                      'h-2 rounded-full transition-[width] duration-700 ease-out',
                      s.size === picked ? 'bg-foreground' : s.available ? 'bg-foreground/35' : 'bg-foreground/15',
                    )}
                    style={{ width: `${s.percent}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className={cn('text-[13px] leading-relaxed text-foreground/80', (headline || shares.length > 0) && 'mt-6')}>{message}</p>
      {picked ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t('finder.result.estimate')}</p>
      ) : (
        <Link href="/contact" className="mt-3 inline-block text-[12px] text-foreground underline underline-offset-4 transition hover:text-gold">
          {t('finder.none.contact')}
        </Link>
      )}
      {onOpenSizeChart && (
        <button type="button" onClick={onOpenSizeChart} className="mt-3 block text-[12px] text-gold underline underline-offset-4">
          {t('fit.sizeChartLink')}
        </button>
      )}
    </div>
  )
}
