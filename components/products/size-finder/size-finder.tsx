'use client'

import { Check, ChevronLeft, ChevronRight, Info, Lock, Ruler } from 'lucide-react'
import Image, { type StaticImageData } from 'next/image'
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
import type { UIKey } from '@/lib/i18n'
import { productImage } from '@/lib/product-image'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { AbdomenFigure, HipsFigure } from './body-shape'
import manAbdomen from './photos/man-abdomen.webp'
import womanAbdomen from './photos/woman-abdomen.webp'
import womanHips from './photos/woman-hips.webp'

/**
 * "Trova la tua misura" — the step-by-step size finder on the product page.
 *
 *   1 height (cm) and weight (kg)      4 abdomen
 *   2 age (optional)                   5 preferred fit, on a slider
 *   3 hips                             6 the size, with a match % per size
 *
 * The rule is lib/fit-advisor.ts (finderRecommendation), the same tables as
 * before: height and weight lead, the rest move the answer by fractions, and
 * the answer is fitted onto the sizes this product makes and has in stock in
 * the colour chosen. It never recommends a size the shopper cannot buy, nor
 * one that is unlikely to be theirs: then the answer is "no size found", with
 * the reason and a way to ask us.
 *
 * LAYOUT. Phones: full screen — the product and "N questions to go" on top,
 * the question, the actions at the foot. From md: a split card — on the left
 * the product photo, the questions as a list that fills in as they are
 * answered, and the privacy line; on the right the question.
 *
 * PHOTOS for the hips and abdomen questions (./photos), by department: the
 * women's set, the men's abdomen. Where there is no photo — men's hips — the
 * line drawing (./body-shape) stands in.
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
const NAV: Record<Step, UIKey> = {
  body: 'finder.nav.body',
  age: 'finder.nav.age',
  hips: 'finder.nav.hips',
  belly: 'finder.nav.belly',
  fit: 'finder.nav.fit',
  result: 'finder.nav.result',
}

const STORAGE_KEY = 'lv.finder.v1'
const SHAPES: ShapeLevel[] = [-1, 0, 1]

/** The reference photo for each body question, by department. */
type Photos = Partial<Record<'hips' | 'belly', StaticImageData>>
const PHOTOS: Record<'women' | 'men', Photos> = {
  women: { hips: womanHips, belly: womanAbdomen },
  men: { belly: manAbdomen },
}

type Saved = {
  cm: string
  kg: string
  age: string
  ageSkipped: boolean
  hips: ShapeLevel
  belly: ShapeLevel
  fitStop: number
}

const EMPTY: Saved = { cm: '', kg: '', age: '', ageSkipped: false, hips: 0, belly: 0, fitStop: 0 }

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
    // Answers saved while the finder still offered ft/in and lb: carried over
    // in centimetres and kilograms, rounded, so nobody is asked again.
    const n = (v: unknown) => num(str(v))
    const ft = n(raw.ft)
    const cm = raw.lengthUnit === 'ftin' && ft !== undefined ? String(Math.round((ft * 12 + (n(raw.inch) ?? 0)) * 2.54)) : str(raw.cm)
    const lb = n(raw.lb)
    const kg = raw.massUnit === 'lb' && lb !== undefined ? String(Math.round(lb * 0.45359237)) : str(raw.kg)
    return {
      cm,
      kg,
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

  const heightCm = num(a.cm)
  const weightKg = num(a.kg)
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

  const photos = PHOTOS[group === 'men' ? 'men' : 'women']

  function openFinder(next: boolean) {
    setOpen(next)
    if (next) {
      // Answers from an earlier product, on this device: filled in, from step 1.
      setA(readSaved() ?? EMPTY)
      setStep('body')
      setError(null)
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
  const canContinue = step === 'body' ? bodyFilled : step === 'age' ? a.ageSkipped || a.age.trim() !== '' : true
  const subtitle =
    step === 'hips' || step === 'belly' ? t('finder.shape.sub') : step === 'fit' ? t('finder.fit.question') : null

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
          'md:grid md:h-[640px] md:max-h-[92vh] md:w-[min(940px,94vw)] md:grid-cols-[300px_1fr] md:rounded-[28px] md:border md:border-border/70',
          'md:shadow-[0_40px_120px_-40px_rgba(28,24,18,0.45)]',
        )}
      >
        <DialogTitle className="sr-only">{t('finder.open')}</DialogTitle>
        <DialogDescription className="sr-only">{tf('finder.step', { n: index + 1, total: STEPS.length })}</DialogDescription>

        {/* ---------------------------------------------------- left panel -- */}
        <aside className="flex shrink-0 items-center gap-3.5 bg-secondary px-4 py-3.5 pr-14 md:flex-col md:items-stretch md:gap-0 md:border-r md:border-border/60 md:bg-[linear-gradient(180deg,hsl(var(--secondary))_0%,hsl(var(--secondary)/0.55)_100%)] md:p-6">
          <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-white shadow-[0_6px_18px_-10px_rgba(28,24,18,0.35)] md:h-[236px] md:w-full md:rounded-2xl">
            <Image src={productImage(image)} alt={name} fill sizes="(min-width: 768px) 252px, 56px" className="object-cover" />
          </div>
          <div aria-live="polite" className="min-w-0 flex-1 md:mt-4 md:flex-none">
            <p className="truncate text-[11px] uppercase tracking-[0.14em] text-foreground/75 md:whitespace-normal md:text-[11.5px] md:leading-snug md:line-clamp-2">{name}</p>
            <p className="mt-0.5 text-[13px] text-foreground/70 md:hidden">{progressText}</p>
          </div>

          {/* The questions, as a list that fills in as they are answered.
              One already answered can be reopened from here. */}
          <ol className="mt-6 hidden space-y-1 md:block">
            {STEPS.map((s, n) => {
              const done = n < index
              const current = n === index
              const label = t(NAV[s])
              return (
                <li key={s}>
                  <button
                    type="button"
                    disabled={!done}
                    onClick={() => go(s)}
                    aria-current={current ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-1.5 py-1 text-left text-[12.5px] transition',
                      current ? 'font-medium text-foreground' : done ? 'text-foreground/80 hover:bg-background/70' : 'text-foreground/55',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] transition',
                        done && 'border-gold bg-gold text-white',
                        current && 'border-foreground bg-foreground text-background',
                        !done && !current && 'border-foreground/25',
                      )}
                    >
                      {done ? <Check className="size-3" strokeWidth={2.5} /> : n + 1}
                    </span>
                    {label}
                  </button>
                </li>
              )
            })}
          </ol>

          <p className="mt-auto hidden items-start gap-2 pt-4 text-[11.5px] leading-snug text-foreground/65 md:flex">
            <Lock aria-hidden className="mt-px size-3.5 shrink-0 text-gold" strokeWidth={1.75} />
            {t('finder.privacyShort')}
          </p>
        </aside>

        {/* --------------------------------------------------- right panel -- */}
        <form
          onSubmit={next}
          noValidate
          className="relative flex min-h-0 flex-1 flex-col bg-[radial-gradient(110%_70%_at_100%_0%,hsl(var(--gold)/0.09)_0%,transparent_60%)]"
        >
          <div className="h-[3px] w-full bg-border/50" aria-hidden>
            <div className="h-full bg-gold transition-all duration-500" style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4 pt-7 sm:px-8 md:px-12 md:pt-11">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-gold" aria-hidden>
              {tf('finder.step', { n: index + 1, total: STEPS.length })}
            </p>
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="mt-2 pr-8 text-[15px] font-semibold uppercase tracking-[0.16em] text-foreground outline-none md:text-[17px]"
            >
              {step === 'body' && t('finder.body.title')}
              {step === 'age' && t('finder.age.title')}
              {step === 'hips' && t('finder.hips.title')}
              {step === 'belly' && t('finder.belly.title')}
              {step === 'fit' && t('finder.fit.title')}
              {step === 'result' &&
                (result?.fit.kind === 'none' && result.fit.reason !== 'sold_out' ? t('finder.none.title') : t('finder.result.title'))}
            </h2>
            {subtitle && <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-foreground/70">{subtitle}</p>}

            <div className={cn('mt-7 flex flex-1 flex-col', (step === 'body' || step === 'age' || step === 'fit') && 'md:justify-center md:pb-10')}>
              {step === 'body' && <BodyStep a={a} set={set} />}
              {step === 'age' && <AgeStep a={a} set={set} onSkip={() => { set({ ageSkipped: true, age: '' }); go('hips') }} />}
              {step === 'hips' && <ShapeStep kind="hips" photo={photos.hips} value={a.hips} onChange={(hips) => set({ hips })} />}
              {step === 'belly' && <ShapeStep kind="belly" photo={photos.belly} value={a.belly} onChange={(belly) => set({ belly })} />}
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
          <div className="flex shrink-0 flex-col items-center gap-3 border-t border-border/50 px-5 pb-5 pt-4 sm:px-8 md:border-t-0 md:px-12 md:pb-9 md:pt-2">
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
              <button type="button" onClick={restart} className="text-[12.5px] text-foreground/80 underline underline-offset-4 hover:text-foreground">
                {t('finder.result.restart')}
              </button>
            ) : index > 0 ? (
              <button
                type="button"
                onClick={() => go(STEPS[index - 1])}
                className="inline-flex items-center gap-1 text-[12.5px] text-foreground/80 transition hover:text-foreground"
              >
                <ChevronLeft aria-hidden className="size-4" />
                {t('finder.back')}
              </button>
            ) : (
              <span className="h-[19px]" aria-hidden />
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const PRIMARY =
  'min-h-[52px] w-full max-w-[420px] rounded-full bg-foreground px-6 py-3 text-[12px] font-semibold uppercase leading-snug tracking-[0.12em] text-background shadow-[0_14px_30px_-16px_rgba(28,24,18,0.6)] transition sm:tracking-[0.2em] [@media(hover:hover)]:hover:text-[hsl(var(--gold-light))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-foreground/15 disabled:text-background disabled:shadow-none'

/** No placeholder and no unit inside: the label above says what and in what. */
const FIELD =
  'h-14 w-full rounded-2xl border border-border bg-card px-5 text-[19px] tabular-nums text-foreground shadow-[inset_0_1px_2px_rgba(28,24,18,0.04)] outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/25'

const LABEL = 'mb-2.5 block text-[11px] uppercase tracking-[0.16em] text-foreground/70'

/** A soft card with a gold icon: the "why" beside a question. */
function Note({ icon: Icon, children }: { icon: typeof Info; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-gold/20 bg-card/70 p-5">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold/10 text-gold">
        <Icon className="size-4" strokeWidth={1.6} />
      </span>
      <p className="text-[13px] leading-relaxed text-foreground/75">{children}</p>
    </div>
  )
}

/** The privacy line, for phones (from md it sits in the left panel). */
function PrivacyLine() {
  const { t } = useStore()
  return (
    <p className="mt-5 flex items-center gap-2 text-[11.5px] text-foreground/65 md:hidden">
      <Lock aria-hidden className="size-3.5 shrink-0 text-gold" strokeWidth={1.75} />
      {t('finder.privacyShort')}
    </p>
  )
}

function BodyStep({ a, set }: { a: Saved; set: (p: Partial<Saved>) => void }) {
  const { t } = useStore()
  return (
    <div className="max-w-lg">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="finder-cm" className={LABEL}>
            {t('finder.height')} (cm)
          </label>
          <input id="finder-cm" inputMode="decimal" autoComplete="off" maxLength={5} className={FIELD} value={a.cm} onChange={(e) => set({ cm: e.target.value })} />
        </div>
        <div>
          <label htmlFor="finder-kg" className={LABEL}>
            {t('finder.weight')} (kg)
          </label>
          <input id="finder-kg" inputMode="decimal" autoComplete="off" maxLength={5} className={FIELD} value={a.kg} onChange={(e) => set({ kg: e.target.value })} />
        </div>
      </div>
      <div className="mt-7">
        <Note icon={Ruler}>{t('finder.body.sub')}</Note>
      </div>
      <PrivacyLine />
    </div>
  )
}

function AgeStep({ a, set, onSkip }: { a: Saved; set: (p: Partial<Saved>) => void; onSkip: () => void }) {
  const { t } = useStore()
  return (
    <div className="max-w-lg">
      <label htmlFor="finder-age" className={LABEL}>
        {t('finder.age.label')}
      </label>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <input
          id="finder-age"
          inputMode="numeric"
          autoComplete="off"
          maxLength={3}
          className={cn(FIELD, 'max-w-[200px]')}
          value={a.age}
          onChange={(e) => set({ age: e.target.value, ageSkipped: false })}
        />
        <button type="button" onClick={onSkip} className="text-[12.5px] text-foreground/70 underline underline-offset-4 hover:text-foreground">
          {t('finder.age.skip')}
        </button>
      </div>
      <div className="mt-7">
        <Note icon={Info}>{t('finder.age.why')}</Note>
      </div>
      <PrivacyLine />
    </div>
  )
}

function ShapeStep({
  kind,
  photo,
  value,
  onChange,
}: {
  kind: 'hips' | 'belly'
  /** A reference photo of the area; without one, the line drawing. */
  photo?: StaticImageData
  value: ShapeLevel
  onChange: (v: ShapeLevel) => void
}) {
  const { t } = useStore()
  const i = SHAPES.indexOf(value)
  const label = (v: ShapeLevel) => t(`finder.${kind}.${v}` as UIKey)
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

  const arrow =
    'flex size-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card/80 text-foreground/70 shadow-sm transition hover:border-foreground/30 hover:text-foreground disabled:opacity-30 disabled:hover:border-border/70'

  return (
    <div className="flex flex-col items-center">
      <div className="flex w-full items-center justify-center gap-3 sm:gap-6">
        <button type="button" onClick={() => move(-1)} disabled={i === 0} aria-label={t('finder.shapePrev')} className={arrow}>
          <ChevronLeft className="size-5" />
        </button>
        {/* The photo sits on the card's warm ground: multiplied, its own
            near-white background disappears into it. Decorative — the radios
            below carry the question and the answer. */}
        <div className="relative h-[200px] w-full max-w-[300px] overflow-hidden rounded-[22px] border border-border/50 bg-[linear-gradient(180deg,#f6f2eb_0%,#eee7dc_100%)] sm:h-[230px]">
          {photo ? (
            <Image src={photo} alt="" fill sizes="300px" loading="eager" className="object-contain object-bottom mix-blend-multiply" />
          ) : (
            <div className="flex h-full items-center justify-center py-4">
              {kind === 'hips' ? <HipsFigure level={value} /> : <AbdomenFigure level={value} />}
            </div>
          )}
        </div>
        <button type="button" onClick={() => move(1)} disabled={i === SHAPES.length - 1} aria-label={t('finder.shapeNext')} className={arrow}>
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div role="radiogroup" aria-label={t(kind === 'hips' ? 'finder.hips.title' : 'finder.belly.title')} onKeyDown={onKey} className="mt-7 grid w-full max-w-md grid-cols-3 gap-2">
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
              className="group flex flex-col items-center gap-2.5 rounded-xl py-2 outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            >
              <span
                className={cn(
                  'flex size-12 items-center justify-center rounded-full border transition',
                  on ? 'border-foreground bg-foreground text-background shadow-[0_10px_22px_-12px_rgba(28,24,18,0.7)]' : 'border-foreground/25 bg-card group-hover:border-foreground/55',
                )}
              >
                {on && <Check aria-hidden className="size-5" strokeWidth={2} />}
              </span>
              <span className={cn('text-center text-[13.5px]', on ? 'font-medium text-foreground' : 'text-foreground/70')}>{label(v)}</span>
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
  const label = (s: number) => t(`finder.fit.${s}` as UIKey)
  const pct = ((stop + 2) / 4) * 100
  return (
    <div className="max-w-lg rounded-2xl border border-border/60 bg-card/70 px-6 pb-5 pt-16 sm:px-8">
      <div className="relative px-1">
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
      ? t(`finder.result.${result.rec.confidence}` as UIKey)
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
        <div className="rounded-2xl border border-border/60 bg-card/70 p-5">
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
        </div>
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
