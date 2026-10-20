'use client'

import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Link } from '@/components/locale-link'
import { PhotoPicker, usePhotoUploads } from '@/components/account/photo-uploader'
import type { UIKey } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import type { ClaimType, Resolution } from '@/lib/refunds/types'
import { cn } from '@/lib/utils'

/**
 * "Request a return or refund" — four short steps: what happened, which
 * items, the details, a last look. What the customer may choose comes from
 * /api/refunds/eligibility, computed on the server from the order and the
 * refund policy; the server checks it all again on submission, and works out
 * the amount itself. Nothing here moves money: a person reviews every request.
 */

type ClaimInfo = {
  allowed: boolean
  refused: string | null
  needsReview: boolean
  requireReturn: boolean
  resolutions: Resolution[]
  minPhotos: number
  deadline: number | null
  waitUntil: number | null
  lines: { orderItemId: string; available: number }[]
}

type Eligibility = {
  order: { number: string; status: string }
  eligible: boolean
  refused: string | null
  lines: { orderItemId: string; name: string; image: string | null; size: string; color: string; qty: number; available: number }[]
  claims: Record<ClaimType, ClaimInfo>
  openCases: { caseNumber: string; state: string }[]
}

/** The order a customer reads them in: the shop's faults first. */
const CLAIM_ORDER: ClaimType[] = [
  'non_delivery',
  'damaged',
  'defective',
  'wrong_item',
  'missing_item',
  'not_as_described',
  'wrong_size',
  'changed_mind',
  'cancel_before_dispatch',
  'other',
]

const DESCRIBE: ClaimType[] = ['damaged', 'defective', 'wrong_item', 'missing_item', 'not_as_described', 'other']

function newKey(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function RefundRequestDialog({
  orderId,
  open,
  onOpenChange,
  onSubmitted,
}: {
  orderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted: () => void
}) {
  const { t, tf, locale, pushToast } = useStore()
  const [data, setData] = useState<Eligibility | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [step, setStep] = useState(0)
  const [claim, setClaim] = useState<ClaimType | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [resolution, setResolution] = useState<Resolution | null>(null)
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  // One key per opening of the form: a double tap, or a retry after a
  // timeout, files ONE case (the server returns the first).
  const [submissionKey] = useState(newKey)
  const uploads = usePhotoUploads()

  useEffect(() => {
    let live = true
    fetch(`/api/refunds/eligibility?order=${encodeURIComponent(orderId)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        return (await res.json()) as Eligibility
      })
      .then((d) => live && setData(d))
      .catch(() => live && setLoadError(true))
    return () => {
      live = false
    }
  }, [orderId])

  const info = claim && data ? data.claims[claim] : null
  const claimLines = useMemo(() => {
    if (!info || !data) return []
    return info.lines.map((l) => ({ ...data.lines.find((x) => x.orderItemId === l.orderItemId)!, available: l.available }))
  }, [info, data])
  const selected = claimLines.filter((l) => (qty[l.orderItemId] ?? 0) > 0)
  const date = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })

  function chooseClaim(type: ClaimType) {
    setClaim(type)
    const c = data!.claims[type]
    // Every available unit pre-selected when there is one line, nothing
    // otherwise: the customer says which.
    const next: Record<string, number> = {}
    if (c.lines.length === 1) next[c.lines[0].orderItemId] = c.lines[0].available
    setQty(next)
    setResolution(c.resolutions.length === 1 ? c.resolutions[0] : null)
    setError(null)
  }

  function canContinue(): boolean {
    if (step === 0) return Boolean(claim && info?.allowed)
    if (step === 1) return selected.length > 0
    if (step === 2) {
      if (!resolution || uploads.uploading) return false
      if (claim && DESCRIBE.includes(claim) && description.trim().length < 10) return false
      return uploads.paths.length >= (info?.minPhotos ?? 0)
    }
    return true
  }

  async function submit() {
    if (!claim || !resolution || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/refunds/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: orderId,
          claimType: claim,
          resolution,
          lines: selected.map((l) => ({ orderItemId: l.orderItemId, qty: qty[l.orderItemId] })),
          description: description.trim(),
          photos: uploads.paths,
          submissionKey,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.error === 'already_claimed' ? t('refund.form.conflict') : t('refund.form.error'))
        return
      }
      setDone(body.case.caseNumber as string)
      pushToast({ title: tf('refund.form.submitted', { n: body.case.caseNumber }), variant: 'gold' })
    } catch {
      setError(t('refund.form.error'))
    } finally {
      setSaving(false)
    }
  }

  const steps: UIKey[] = ['refund.form.stepWhat', 'refund.form.stepItems', 'refund.form.stepDetails', 'refund.form.stepReview']

  // The list behind the dialog is refreshed when the dialog CLOSES after a
  // submission, not at the moment of it: refreshing unmounts this dialog,
  // and the customer would lose the confirmation with their case number.
  const close = (next: boolean) => {
    if (!next && done) onSubmitted()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('refund.form.title')}</DialogTitle>
          <DialogDescription>
            {done ? tf('refund.form.submitted', { n: done }) : `${orderId} · ${t(steps[step])}`}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-5">
            <p className="flex items-center gap-2 text-[13px] font-light text-foreground">
              <Check aria-hidden className="size-4 text-gold" />
              {t('refund.form.reviewNotice')}
            </p>
            <Link
              href={`/account?section=returns&case=${encodeURIComponent(done)}`}
              onClick={() => close(false)}
              className="tap-safe inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gold px-6 text-[11px] uppercase tracking-[0.2em] text-gold transition-colors hover:bg-gold/10"
            >
              {t('refund.form.viewRequest')}
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </div>
        ) : loadError ? (
          <p className="flex items-start gap-2 text-[13px] font-light text-destructive">
            <AlertCircle className="mt-px size-4 shrink-0" />
            {t('refund.form.loadError')}
          </p>
        ) : !data ? (
          <div className="flex justify-center py-10">
            <Loader2 aria-hidden className="size-5 animate-spin text-gold" />
          </div>
        ) : !data.eligible ? (
          <div className="space-y-3 text-[13px] font-light text-foreground/80">
            <p>{data.refused ? t(`refund.refused.${data.refused}` as UIKey) : t('refund.form.nothing')}</p>
            {data.openCases.length > 0 && <OpenCases cases={data.openCases} />}
          </div>
        ) : (
          <div className="space-y-6">
            {data.openCases.length > 0 && step === 0 && <OpenCases cases={data.openCases} />}

            {step === 0 && (
              <fieldset>
                <legend className="sr-only">{t('refund.form.stepWhat')}</legend>
                <div className="space-y-1.5">
                  {CLAIM_ORDER.filter((type) => data.claims[type].allowed || data.claims[type].refused === 'withdrawal_window_closed').map((type) => {
                    const c = data.claims[type]
                    return (
                      <label
                        key={type}
                        className={cn(
                          'flex items-start gap-3 rounded-xl border px-4 py-3 text-[13px] font-light transition-colors duration-200',
                          !c.allowed ? 'cursor-not-allowed border-border/40 text-foreground/45' : 'cursor-pointer',
                          claim === type ? 'border-gold/50 bg-gold/5 text-foreground' : c.allowed && 'border-border/60 text-foreground/75 hover:border-gold/30',
                        )}
                      >
                        <input
                          type="radio"
                          name="claim-type"
                          value={type}
                          checked={claim === type}
                          disabled={!c.allowed}
                          onChange={() => chooseClaim(type)}
                          className="mt-0.5 size-3.5 accent-gold"
                        />
                        <span>
                          {t(`refund.claim.${type}` as UIKey)}
                          {!c.allowed && c.refused && (
                            <span className="mt-1 block text-[12px] text-foreground/55">{t(`refund.refused.${c.refused}` as UIKey)}</span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {step === 1 && (
              <ul className="space-y-2">
                {claimLines.map((l) => (
                  <li key={l.orderItemId} className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5">
                    {l.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.image} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="size-12 shrink-0 rounded-lg bg-muted/40" />
                    )}
                    <span className="min-w-0 flex-1 text-[13px] font-light text-foreground">
                      <span className="block truncate">{l.name}</span>
                      <span className="block text-[11px] text-foreground/55">
                        {l.size} · {l.color} · {tf('refund.form.available', { n: l.available })}
                        {l.available < l.qty && ` · ${t('refund.form.alreadyClaimed')}`}
                      </span>
                    </span>
                    <label className="sr-only" htmlFor={`qty-${l.orderItemId}`}>
                      {t('refund.form.qty')}
                    </label>
                    <select
                      id={`qty-${l.orderItemId}`}
                      value={qty[l.orderItemId] ?? 0}
                      onChange={(e) => setQty((q) => ({ ...q, [l.orderItemId]: Number(e.target.value) }))}
                      className="min-h-[40px] rounded-lg border border-border bg-background px-2 text-[13px] text-foreground"
                    >
                      {Array.from({ length: l.available + 1 }, (_, n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}

            {step === 2 && info && (
              <div className="space-y-5">
                {info.resolutions.length > 1 && (
                  <fieldset>
                    <legend className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t('refund.form.resolution')}</legend>
                    <div className="mt-3 space-y-1.5">
                      {info.resolutions.map((r) => (
                        <label
                          key={r}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-[13px] font-light transition-colors',
                            resolution === r ? 'border-gold/50 bg-gold/5 text-foreground' : 'border-border/60 text-foreground/75 hover:border-gold/30',
                          )}
                        >
                          <input type="radio" name="resolution" value={r} checked={resolution === r} onChange={() => setResolution(r)} className="size-3.5 accent-gold" />
                          {t(`refund.res.${r}` as UIKey)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                <div>
                  <label htmlFor="refund-description" className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    {t('refund.form.description')}
                  </label>
                  <textarea
                    id="refund-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder={t('refund.form.descriptionHint')}
                    className="mt-3 w-full resize-none rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] font-light text-foreground outline-none transition placeholder:text-muted-foreground/55 focus:border-gold"
                  />
                  {claim && DESCRIBE.includes(claim) && description.trim().length < 10 && (
                    <p className="mt-1.5 text-[12px] font-light text-foreground/55">{t('refund.form.descriptionRequired')}</p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t('rma.photos')}</p>
                  <p className="mb-3 mt-1.5 text-[12px] font-light text-muted-foreground/90">
                    {info.minPhotos > 0 ? tf('refund.form.photosRequired', { n: info.minPhotos }) : t('rma.photosHint')}
                  </p>
                  <PhotoPicker uploads={uploads} />
                </div>
              </div>
            )}

            {step === 3 && info && claim && resolution && (
              <div className="space-y-4 text-[13px] font-light text-foreground/85">
                <dl className="space-y-2">
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t('refund.form.stepWhat')}</dt>
                    <dd>{t(`refund.claim.${claim}` as UIKey)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t('refund.form.stepItems')}</dt>
                    <dd>
                      {selected.map((l) => (
                        <span key={l.orderItemId} className="block">
                          {qty[l.orderItemId]} × {l.name} ({l.size}, {l.color})
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{t('refund.form.resolution')}</dt>
                    <dd>{t(`refund.res.${resolution}` as UIKey)}</dd>
                  </div>
                </dl>
                {info.waitUntil && <Notice>{tf('refund.form.waitNotice', { date: date(info.waitUntil) })}</Notice>}
                {info.requireReturn && <Notice>{t('refund.form.returnNotice')}</Notice>}
                {(claim === 'wrong_size' || claim === 'changed_mind') && (
                  <Notice>
                    {t('rma.conditionNote')}{' '}
                    <Link href="/legal/refunds" target="_blank" className="text-gold underline underline-offset-2 hover:no-underline">
                      {t('rma.policyLink')}
                    </Link>
                  </Notice>
                )}
                <Notice>{t('refund.form.reviewNotice')}</Notice>
              </div>
            )}

            {error && (
              <p role="alert" className="flex items-start gap-2 text-[12px] font-light leading-snug text-destructive">
                <AlertCircle className="mt-px size-3.5 shrink-0" />
                {error}
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))}
                className="tap-safe inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border px-6 text-[11px] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
              >
                {step > 0 && <ArrowLeft aria-hidden className="size-3.5" />}
                {step === 0 ? t('rma.cancel') : t('refund.form.back')}
              </button>
              {step < 3 ? (
                <button
                  type="button"
                  disabled={!canContinue()}
                  onClick={() => setStep(step + 1)}
                  title={step === 1 && selected.length === 0 ? t('refund.form.chooseItems') : uploads.uploading ? t('rma.photosUploading') : undefined}
                  className="tap-safe inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-gold px-8 text-[11px] uppercase tracking-[0.2em] text-gold transition-colors enabled:hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('refund.form.next')}
                  <ArrowRight aria-hidden className="size-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void submit()}
                  className="tap-safe no-juice inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-gold bg-gold-gradient px-8 text-[11px] uppercase tracking-[0.2em] text-gold-foreground shadow-gold transition-colors duration-300 enabled:hover:bg-transparent enabled:hover:text-gold disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <RotateCcw aria-hidden className="size-3.5" />}
                  {t('refund.form.submit')}
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-border/60 bg-muted/20 px-3.5 py-3 text-[12px] leading-relaxed text-foreground/75">{children}</p>
}

function OpenCases({ cases }: { cases: { caseNumber: string; state: string }[] }) {
  const { t, tf } = useStore()
  return (
    <p className="text-[12px] font-light text-foreground/70">
      {tf('refund.form.openRequests', { list: '' })}
      {cases.map((c, i) => (
        <span key={c.caseNumber}>
          {i > 0 && ', '}
          <Link href={`/account?section=returns&case=${encodeURIComponent(c.caseNumber)}`} className="text-gold underline underline-offset-2 hover:no-underline">
            {c.caseNumber}
          </Link>{' '}
          ({t(`refund.state.${c.state}` as UIKey)})
        </span>
      ))}
    </p>
  )
}
