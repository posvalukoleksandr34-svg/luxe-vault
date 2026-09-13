'use client'

import { LayoutGrid, RefreshCw, RotateCcw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { StateActionButton } from '@/components/state-view'
import { Consultation, type SkippedSteps } from '@/components/stylist/consultation'
import { LookSkeleton, LookView } from '@/components/stylist/look-view'
import { StylistFallback, StylistSummary } from '@/components/stylist/stylist-summary'
import { useStore } from '@/lib/store'
import type { Refinement, StylistBrief, StylistResult } from '@/lib/stylist/types'

/**
 * The stylist, end to end: consultation -> final screen -> variations.
 *
 * The final screen is one layout whatever happened: the customer's answers at
 * the top, then the looks — or, when none could be built, a fallback with
 * catalogue picks — then "Start over" and "Go to catalog". The state machine
 * lives here and the presentation in the components below it, so the
 * fetching, the brief and the seed are in one readable place.
 */

type Phase = 'consult' | 'loading' | 'result' | 'error'

export function StylistExperience({ anchorProductId }: { anchorProductId?: string }) {
  const { t, locale } = useStore()
  const [phase, setPhase] = useState<Phase>('consult')
  const [result, setResult] = useState<StylistResult | null>(null)
  const [brief, setBrief] = useState<StylistBrief>({})
  const [skipped, setSkipped] = useState<SkippedSteps>({})
  // Increments on every "try another" so the engine walks down its ranking
  // instead of returning the same look.
  const [seed, setSeed] = useState(0)
  const [busy, setBusy] = useState(false)
  // A variation that failed. The look already on screen stays; losing it to
  // an error page because one refinement timed out would be worse.
  const [refineFailed, setRefineFailed] = useState(false)
  const [lastRefinement, setLastRefinement] = useState<Refinement | undefined>(undefined)

  const run = useCallback(
    async (
      nextBrief: StylistBrief,
      refinement?: Refinement,
      nextSeed = 0,
      { fresh = false }: { fresh?: boolean } = {},
    ) => {
      const refining = !fresh && result !== null
      setBusy(true)
      setRefineFailed(false)
      if (!refining) setPhase('loading')
      try {
        const res = await fetch('/api/stylist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The page's language travels with the brief: the stylist writes
          // in the customer's own words' language, and in this one when the
          // brief has no words of theirs to go by.
          body: JSON.stringify({ brief: nextBrief, refinement, seed: nextSeed, locale }),
        })
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as StylistResult
        setResult(data)
        // The server echoes the brief it actually used, so a refinement that
        // changed the budget is reflected in the next refinement too.
        if (data.brief) setBrief(data.brief)
        setPhase('result')
      } catch {
        if (refining) setRefineFailed(true)
        else setPhase('error')
      } finally {
        setBusy(false)
      }
    },
    [result, locale],
  )

  function start(b: StylistBrief, sk: SkippedSteps) {
    const withAnchor = anchorProductId ? { ...b, anchorProductId } : b
    setBrief(withAnchor)
    setSkipped(sk)
    setSeed(0)
    setResult(null)
    void run(withAnchor, undefined, 0, { fresh: true })
  }

  function refine(r: Refinement) {
    const nextSeed = r === 'another' ? seed + 1 : seed
    setSeed(nextSeed)
    setLastRefinement(r)
    void run(brief, r, nextSeed)
  }

  function restart() {
    setResult(null)
    setBrief({})
    setSkipped({})
    setSeed(0)
    setRefineFailed(false)
    setPhase('consult')
  }

  /** Back to the questions with every answer still filled in. */
  function editAnswers() {
    setResult(null)
    setRefineFailed(false)
    setPhase('consult')
  }

  if (phase === 'consult') {
    return <Consultation initial={brief} initialSkipped={skipped} onComplete={start} />
  }

  const emptyHint =
    result && result.looks.length === 0
      ? result.catalogSize === 0
        ? t('stylist.empty')
        : `${t('stylist.missing')} ${result.missingSlots
            .map((m) => t(`stylist.slot.${m}` as Parameters<typeof t>[0]))
            .join(', ')}`
      : undefined

  return (
    <div>
      <StylistSummary brief={brief} skipped={skipped} onEdit={phase === 'loading' ? undefined : editAnswers} />

      {phase === 'loading' && <LookSkeleton />}

      {phase === 'error' && (
        <StylistFallback
          kind="failed"
          brief={brief}
          onRetry={() => void run(brief, undefined, seed, { fresh: true })}
        />
      )}

      {phase === 'result' && result && result.looks.length === 0 && (
        <StylistFallback kind="empty" brief={brief} hint={emptyHint} />
      )}

      {phase === 'result' && result && result.looks.length > 0 && (
        <>
          {refineFailed && (
            <div
              role="alert"
              className="mb-6 flex flex-wrap items-center justify-between gap-3 border-l-2 border-gold/40 bg-gold/[0.04] py-2.5 pl-4 pr-2"
            >
              <p className="text-[12px] font-light text-muted-foreground">{t('stylist.refineFailed')}</p>
              <StateActionButton
                variant="secondary"
                action={{
                  label: t('common.retry'),
                  icon: RefreshCw,
                  onClick: () => void run(brief, lastRefinement, seed),
                }}
              />
            </div>
          )}
          {busy && (
            <p className="mb-6 text-[12px] uppercase tracking-[0.25em] text-gold/70">
              {t('stylist.loading')}
            </p>
          )}
          <LookView
            result={result}
            busy={busy}
            onRefine={refine}
            onRestart={restart}
            showRestart={false}
          />
        </>
      )}

      {/* The way out of the final screen, whatever it shows. */}
      {phase !== 'loading' && (
        <div className="mt-14 flex flex-col gap-3 border-t border-border/40 pt-8 sm:flex-row sm:items-center">
          <StateActionButton
            variant="outline"
            action={{ label: t('stylist.restart'), onClick: restart, icon: RotateCcw }}
          />
          <StateActionButton
            variant="secondary"
            action={{ label: t('state.goToCatalog'), href: '/#shop', icon: LayoutGrid }}
          />
        </div>
      )}
    </div>
  )
}
