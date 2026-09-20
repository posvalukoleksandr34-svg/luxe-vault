'use client'

import { ChevronDown, Ruler } from 'lucide-react'
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
  fitBreakdown,
  fitCategoryOf,
  fitShoeToProduct,
  fitToProduct,
  indexOfSize,
  isLetterSizeRun,
  isNumericSizeRun,
  recommendSize,
  round1,
  sizeFromChest,
  toCm,
  toInches,
  toKg,
  toLb,
  type AreaVerdict,
  type BodyType,
  type FitPreference,
  type FitRecommendation,
  type FootWidth,
  type Gender,
  type LetterSize,
  type ProductFit,
  type ShoeFit,
  type UnitSystem,
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
const GENDERS: Gender[] = ['female', 'male', 'unspecified']
const BODY_TYPES: BodyType[] = ['slim', 'average', 'athletic', 'broad']
const FOOT_WIDTHS: FootWidth[] = ['narrow', 'regular', 'wide']

/** Verdict level -> the word for it. */
const LEVEL_KEY = {
  '-2': 'fit.level.tight',
  '-1': 'fit.level.snug',
  '0': 'fit.level.perfect',
  '1': 'fit.level.relaxed',
  '2': 'fit.level.loose',
} as const

/** Inputs are remembered on this device so the next product does not ask
 *  again. Local only — body measurements have no business on a server. */
const STORAGE_KEY = 'lv.fit.v1'

type Result = {
  rec: FitRecommendation
  fit: ProductFit
  /** The measurements the answer was computed from, for the breakdown. */
  input: Parameters<typeof fitBreakdown>[0]
}

export function FitAdvisorModal({
  sizes,
  isAvailable,
  onApply,
  productCut,
  sizeChart,
  productId,
  group,
  category,
  onOpenSizeChart,
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
  /** The catalogue slug, for the most-bought-size statistic. */
  productId?: string
  /** Where the product sits in the catalogue: decides which fields to ask for. */
  group?: string
  category?: string
  /** Scrolls the page to the printed size chart, when the page has one. */
  onOpenSizeChart?: () => void
}) {
  const { t, tf, localize } = useStore()
  const [open, setOpen] = useState(false)
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [usual, setUsual] = useState<LetterSize | null>(null)
  const [preference, setPreference] = useState<FitPreference>('regular')
  const [units, setUnits] = useState<UnitSystem>('metric')
  const [gender, setGender] = useState<Gender>('unspecified')
  const [bodyType, setBodyType] = useState<BodyType>('average')
  const [chest, setChest] = useState('')
  const [waist, setWaist] = useState('')
  const [hips, setHips] = useState('')
  const [inseam, setInseam] = useState('')
  const [foot, setFoot] = useState('')
  const [footWidth, setFootWidth] = useState<FootWidth>('regular')
  const [showMore, setShowMore] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [stat, setStat] = useState<{ size: string; percent: number; sample: number } | null>(null)
  const [shoe, setShoe] = useState<ShoeFit | null>(null)
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
        // Everything below was added with the advanced finder; an older saved
        // payload simply has none of it.
        if (saved.units === 'imperial' || saved.units === 'metric') setUnits(saved.units)
        if (GENDERS.indexOf(saved.gender) !== -1) setGender(saved.gender)
        if (BODY_TYPES.indexOf(saved.bodyType) !== -1) setBodyType(saved.bodyType)
        if (FOOT_WIDTHS.indexOf(saved.footWidth) !== -1) setFootWidth(saved.footWidth)
        for (const [key, set] of [
          ['chest', setChest],
          ['waist', setWaist],
          ['hips', setHips],
          ['inseam', setInseam],
          ['foot', setFoot],
        ] as const) {
          if (typeof saved[key] === 'string') set(saved[key])
        }
        if (saved.chest || saved.waist || saved.hips || saved.inseam) setShowMore(true)
        setSavedNote(true)
      }
    } catch {
      // Storage unavailable (private mode, blocked) — start blank.
    }
  }, [])

  // The most-bought size, once the dialog is actually opened — a product page
  // should not spend a request on a dialog nobody opens.
  useEffect(() => {
    if (!open || !productId || stat !== null) return
    let cancelled = false
    fetch(`/api/products/${encodeURIComponent(productId)}/size-stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.stat) setStat(data.stat)
      })
      .catch(() => {
        // No statistic is a fine outcome; the finder stands without it.
      })
    return () => {
      cancelled = true
    }
  }, [open, productId, stat])

  // Which fields this product needs. Shoes are sold in a numeric run and ask
  // for a foot length instead of a chest; anything that is neither (a cap, a
  // bag) still gets no advisor at all.
  const fitKind = fitCategoryOf(group, category)
  const shoeMode = fitKind === 'shoes' && isNumericSizeRun(sizes)
  if (!shoeMode && !isLetterSizeRun(sizes)) return null

  const hasChart = Boolean(sizeChart?.length)
  const imperial = units === 'imperial'
  /** Reads a typed number in the CURRENT unit and returns centimetres. */
  const lengthCm = (v: string) => {
    const n = v.trim() ? Number(v.trim().replace(',', '.')) : undefined
    if (n === undefined || Number.isNaN(n)) return undefined
    return imperial ? toCm(n) : n
  }
  const massKg = (v: string) => {
    const n = v.trim() ? Number(v.trim().replace(',', '.')) : undefined
    if (n === undefined || Number.isNaN(n)) return undefined
    return imperial ? toKg(n) : n
  }

  /** Switching units rewrites what is already typed, so the numbers keep
   *  meaning the same body rather than silently becoming a different one. */
  function switchUnits(next: UnitSystem) {
    if (next === units) return
    const conv = (v: string, kind: 'len' | 'mass') => {
      const n = v.trim() ? Number(v.trim().replace(',', '.')) : NaN
      if (Number.isNaN(n)) return v
      const out =
        kind === 'len' ? (next === 'imperial' ? toInches(n) : toCm(n)) : next === 'imperial' ? toLb(n) : toKg(n)
      return String(round1(out))
    }
    setHeight((v) => conv(v, 'len'))
    setWeight((v) => conv(v, 'mass'))
    setChest((v) => conv(v, 'len'))
    setWaist((v) => conv(v, 'len'))
    setHips((v) => conv(v, 'len'))
    setInseam((v) => conv(v, 'len'))
    setFoot((v) => conv(v, 'len'))
    setUnits(next)
    setResult(null)
    setShoe(null)
  }

  // Any change to the inputs invalidates a previous answer rather than leaving
  // a recommendation on screen that no longer matches what is typed.
  function edit(apply: () => void) {
    apply()
    setResult(null)
    setError(null)
  }

  function calculate() {
    // Shoes answer from the foot alone: height and weight say nothing about
    // a last, and pretending otherwise would be the confident wrong answer
    // this component exists to avoid.
    if (shoeMode) {
      const footCm = lengthCm(foot)
      if (!footCm || footCm < 15 || footCm > 40) {
        setShoe(null)
        setResult(null)
        setError(t('fit.needFoot'))
        return
      }
      setShoe(fitShoeToProduct(footCm, sizes, isAvailable, footWidth))
      setResult(null)
      setError(null)
      persist()
      return
    }

    const input = {
      heightCm: lengthCm(height),
      weightKg: massKg(weight),
      usualSize: usual ?? undefined,
      preference,
      productCut,
      gender,
      bodyType,
      chestCm: lengthCm(chest),
      waistCm: lengthCm(waist),
      hipsCm: lengthCm(hips),
      inseamCm: lengthCm(inseam),
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

    // A measured chest against this product's own chart beats height and
    // weight, which only ever approximated it. Only when both exist.
    const measured = input.chestCm ? sizeFromChest(input.chestCm, sizeChart ?? [], preference) : null
    if (measured && indexOfSize(measured.size) !== -1) {
      const fromChart = indexOfSize(measured.size)
      // The tape wins — it compares the garment's own number against the
      // body's. But when it lands more than a size away from what height and
      // weight suggested, the two disagree and the answer is not "high": one
      // of them is reading this cut differently, and the shopper should know.
      const gap = Math.abs(fromChart - indexOfSize(rec.size))
      rec = {
        ...rec,
        size: LETTER_SIZES[fromChart],
        confidence: gap >= 2 ? 'low' : gap >= 1 ? 'medium' : 'high',
      }
    } else if (!hasChart && rec.confidence === 'high') {
      // Without this product's own measurements the answer rests on standard
      // sizing alone — never present that as certain.
      rec = { ...rec, confidence: 'medium' }
    }

    setResult({ rec, fit: fitToProduct(rec, sizes, isAvailable), input })
    setShoe(null)
    setError(null)
    persist()
  }

  /** Remembers the measurements on this device only. */
  function persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          height, weight, usual, preference, units, gender, bodyType,
          chest, waist, hips, inseam, foot, footWidth,
        }),
      )
      setSavedNote(true)
    } catch {
      // Not remembering is fine.
    }
  }

  function forget() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Nothing to clear.
    }
    setSavedNote(false)
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

  // The size chart row for the size actually offered, and the verdicts that
  // compare the shopper's own measurements against it.
  const verdicts: AreaVerdict[] = result && row ? fitBreakdown(result.input, row, preference) : []

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
          {/* Units. Switching rewrites what is typed, so the numbers always
              describe the same body. */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {t('fit.units.label')}
            </span>
            <div className="flex">
              {(['metric', 'imperial'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => switchUnits(u)}
                  aria-pressed={units === u}
                  className={cn(
                    'border px-3 py-1.5 text-[11px] transition-colors duration-200',
                    units === u
                      ? 'border-gold bg-gold/5 text-gold'
                      : 'border-border text-foreground/60 hover:text-foreground',
                  )}
                >
                  {t(`fit.units.${u}` as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
          </div>

          {shoeMode ? (
            <>
              <label className="block">
                <span className={labelClass}>
                  {t('fit.footLength')}, {imperial ? 'in' : t('sizeGuide.cm')}
                </span>
                <input
                  id="fit-foot"
                  name="foot"
                  autoComplete="off"
                  inputMode="decimal"
                  value={foot}
                  onChange={(e) => edit(() => setFoot(e.target.value))}
                  placeholder={imperial ? '10.5' : '26.5'}
                  className={inputClass}
                />
                <span className="mt-1.5 block text-[11px] font-light leading-relaxed text-muted-foreground/80">
                  {t('fit.footHint')}
                </span>
              </label>
              <fieldset>
                <legend className={labelClass}>{t('fit.footWidth')}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {FOOT_WIDTHS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => edit(() => setFootWidth(w))}
                      aria-pressed={footWidth === w}
                      className={cn(
                        'min-h-[44px] border px-2 text-[12px] transition-colors duration-200',
                        footWidth === w
                          ? 'border-gold bg-gold/5 text-gold'
                          : 'border-border text-foreground/70 hover:border-foreground/30 hover:text-foreground',
                      )}
                    >
                      {t(`fit.footWidth.${w}` as Parameters<typeof t>[0])}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>{imperial ? t('fit.heightImperial') : t('fit.height')}</span>
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
                placeholder={imperial ? '70' : '178'}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>{imperial ? t('fit.weightImperial') : t('fit.weight')}</span>
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
                placeholder={imperial ? '159' : '72'}
                className={inputClass}
              />
            </label>
          </div>
          )}

          {!shoeMode && (
            <>
              <fieldset>
                <legend className={labelClass}>{t('fit.gender')}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {GENDERS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => edit(() => setGender(g))}
                      aria-pressed={gender === g}
                      className={cn(
                        'min-h-[40px] border px-2 text-[11px] leading-tight transition-colors duration-200',
                        gender === g
                          ? 'border-gold bg-gold/5 text-gold'
                          : 'border-border text-foreground/70 hover:border-foreground/30 hover:text-foreground',
                      )}
                    >
                      {t(`fit.gender.${g}` as Parameters<typeof t>[0])}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className={labelClass}>{t('fit.bodyType')}</legend>
                <div className="grid grid-cols-4 gap-1.5">
                  {BODY_TYPES.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => edit(() => setBodyType(b))}
                      aria-pressed={bodyType === b}
                      className={cn(
                        'min-h-[44px] border px-1 text-[11px] leading-tight transition-colors duration-200',
                        bodyType === b
                          ? 'border-gold bg-gold/5 text-gold'
                          : 'border-border text-foreground/70 hover:border-foreground/30 hover:text-foreground',
                      )}
                    >
                      {t(`fit.bodyType.${b}` as Parameters<typeof t>[0])}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}

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

          {/* Exact measurements. Folded away by default — most shoppers will
              not have a tape to hand, and the finder works without them — but
              a measured chest is what turns an estimate into an answer. */}
          {!shoeMode && (
            <div className="border border-border/60">
              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                aria-expanded={showMore}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[12px] text-foreground/80 transition hover:text-foreground"
              >
                {t('fit.more')}
                <ChevronDown aria-hidden className={cn('size-4 transition-transform', showMore && 'rotate-180')} />
              </button>
              {showMore && (
                <div className="grid grid-cols-2 gap-3 border-t border-border/60 p-3">
                  {([
                    ['chest', chest, setChest, fitKind !== 'bottoms'],
                    ['waist', waist, setWaist, true],
                    ['hips', hips, setHips, fitKind === 'bottoms' || gender === 'female'],
                    ['inseam', inseam, setInseam, fitKind === 'bottoms'],
                  ] as const)
                    .filter(([, , , show]) => show)
                    .map(([key, value, set]) => (
                      <label key={key} className="block">
                        <span className={labelClass}>
                          {t(`fit.${key}` as Parameters<typeof t>[0])}, {imperial ? 'in' : t('sizeGuide.cm')}
                        </span>
                        <input
                          name={key}
                          autoComplete="off"
                          inputMode="decimal"
                          value={value}
                          onChange={(e) => edit(() => set(e.target.value))}
                          className={inputClass}
                        />
                      </label>
                    ))}
                </div>
              )}
            </div>
          )}

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

        {shoe && (
          <div role="status" className="border border-gold/30 bg-gold/[0.04] p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t('fit.recommendedLabel')}
            </p>
            <p className="mt-1.5 font-serif text-5xl font-bold leading-none text-gold">{shoe.size}</p>
            <p className="mt-3 text-[13px] font-light leading-relaxed text-foreground/90">
              {tf('fit.shoeResult', { eu: Math.round(shoe.euExact * 2) / 2 })}
            </p>
            {shoe.widthNote !== 'none' && (
              <p className="mt-2 text-[12px] font-light text-muted-foreground">
                {shoe.widthNote === 'wide' ? t('fit.shoeWide') : t('fit.shoeNarrow')}
              </p>
            )}
            {stat && (
              <p className="mt-3 border-t border-gold/15 pt-3 text-[12px] font-light text-foreground/85">
                {tf('fit.social', { percent: stat.percent, size: stat.size })}{' '}
                <span className="text-muted-foreground">· {tf('fit.socialSample', { n: stat.sample })}</span>
              </p>
            )}
            <button
              type="button"
              onClick={() => apply(shoe.size)}
              className="mt-4 w-full border border-gold bg-gold px-5 py-3 text-[12px] uppercase tracking-[0.15em] text-gold-foreground transition-opacity duration-300 hover:opacity-90"
            >
              {tf('fit.apply', { size: shoe.size })}
            </button>
          </div>
        )}

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

            {/* The detailed rating: one line per area the shopper actually
                measured, compared against this size's own numbers. Areas
                nobody measured say nothing rather than guessing. */}
            {verdicts.length > 0 && (
              <div className="mt-4 border-t border-gold/15 pt-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{t('fit.rating')}</p>
                <ul className="mt-2 space-y-1.5">
                  {verdicts.map((v) => (
                    <li key={v.area} className="flex items-baseline justify-between gap-3 text-[12px]">
                      <span className="text-foreground/80">
                        {t(`fit.area.${v.area}` as Parameters<typeof t>[0])}
                      </span>
                      <span className={cn('font-light', v.level === 0 ? 'text-gold' : 'text-muted-foreground')}>
                        {t(LEVEL_KEY[String(v.level) as keyof typeof LEVEL_KEY])}
                        {typeof v.slackCm === 'number' && v.slackCm > 0 && (
                          <span className="tabular-nums"> · +{v.slackCm} {t('sizeGuide.cm')}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Social proof, from real orders only: the most-bought size for
                THIS product, and never below a meaningful sample. It makes no
                claim about buyers with the shopper's measurements, because
                orders do not record bodies. */}
            {stat && (
              <p className="mt-4 border-t border-gold/15 pt-3 text-[12px] font-light leading-relaxed text-foreground/85">
                {tf('fit.social', { percent: stat.percent, size: stat.size })}{' '}
                <span className="text-muted-foreground">· {tf('fit.socialSample', { n: stat.sample })}</span>
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

        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* The printed chart, one tap away: the finder is an estimate, and
              the real numbers are the answer for anyone with a tape. */}
          {(hasChart || onOpenSizeChart) && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onOpenSizeChart?.()
              }}
              className="inline-flex items-center gap-1.5 text-[12px] text-gold underline-offset-4 transition hover:underline"
            >
              <Ruler aria-hidden className="size-3.5" />
              {t('fit.sizeChartLink')}
            </button>
          )}
          {savedNote && (
            <span className="flex items-center gap-2 text-[11px] font-light text-muted-foreground">
              {t('fit.saved')}
              <button
                type="button"
                onClick={forget}
                className="text-foreground/70 underline underline-offset-4 transition hover:text-foreground"
              >
                {t('fit.clearSaved')}
              </button>
            </span>
          )}
        </div>

        <p className="text-[11px] font-light leading-relaxed text-muted-foreground/80">
          {t('fit.disclaimer')}
        </p>
      </DialogContent>
    </Dialog>
  )
}
