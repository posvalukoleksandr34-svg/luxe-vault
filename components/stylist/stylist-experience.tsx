'use client'

import { useCallback, useState } from 'react'
import { LoadError } from '@/components/load-error'
import { Consultation } from '@/components/stylist/consultation'
import { LookSkeleton, LookView } from '@/components/stylist/look-view'
import { useStore } from '@/lib/store'
import type { Refinement, StylistBrief, StylistResult } from '@/lib/stylist/types'

/**
 * The stylist, end to end: consultation -> looks -> variations.
 *
 * The state machine lives here and the presentation lives in the two
 * components below it, so the fetching, the brief and the seed are in one
 * readable place rather than spread through the UI.
 */

type Phase = 'consult' | 'loading' | 'result' | 'error'

export function StylistExperience({ anchorProductId }: { anchorProductId?: string }) {
  const { t } = useStore()
  const [phase, setPhase] = useState<Phase>('consult')
  const [result, setResult] = useState<StylistResult | null>(null)
  const [brief, setBrief] = useState<StylistBrief>({})
  // Increments on every "try another" so the engine walks down its ranking
  // instead of returning the same look.
  const [seed, setSeed] = useState(0)
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (nextBrief: StylistBrief, refinement?: Refinement, nextSeed = 0) => {
      setBusy(true)
      if (!result) setPhase('loading')
      try {
        const res = await fetch('/api/stylist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brief: nextBrief, refinement, seed: nextSeed }),
        })
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as StylistResult
        setResult(data)
        // The server echoes the brief it actually used, so a refinement that
        // changed the budget is reflected in the next refinement too.
        if (data.brief) setBrief(data.brief)
        setPhase('result')
      } catch {
        setPhase('error')
      } finally {
        setBusy(false)
      }
    },
    [result],
  )

  function start(b: StylistBrief) {
    const withAnchor = anchorProductId ? { ...b, anchorProductId } : b
    setBrief(withAnchor)
    setSeed(0)
    void run(withAnchor, undefined, 0)
  }

  function refine(r: Refinement) {
    const nextSeed = r === 'another' ? seed + 1 : seed
    setSeed(nextSeed)
    void run(brief, r, nextSeed)
  }

  function restart() {
    setResult(null)
    setBrief({})
    setSeed(0)
    setPhase('consult')
  }

  if (phase === 'consult') {
    return <Consultation initial={brief} onComplete={start} />
  }

  if (phase === 'loading') return <LookSkeleton />

  if (phase === 'error' || !result) {
    return <LoadError title={t('stylist.failed')} onRetry={() => run(brief, undefined, seed)} />
  }

  return (
    <>
      {busy && (
        <p className="mb-6 text-[12px] uppercase tracking-[0.25em] text-gold/70">
          {t('stylist.loading')}
        </p>
      )}
      <LookView result={result} busy={busy} onRefine={refine} onRestart={restart} />
    </>
  )
}
