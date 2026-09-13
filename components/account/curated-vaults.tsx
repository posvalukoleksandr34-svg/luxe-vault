'use client'

import { Bookmark, Loader2, Sparkles, Trash2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { forgetLook } from '@/lib/saved-looks'
import { formatPrice, useStore } from '@/lib/store'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Product } from '@/lib/types'

/**
 * Curated Vaults — the capsules this customer has saved.
 *
 * Reads public.saved_looks directly with the browser client rather than
 * through an API route. That is not a shortcut: 0024 already carries an RLS
 * policy for exactly this ("owners read their own", "owners delete their
 * own"), so the database itself enforces that one customer cannot list or
 * delete another's rows. An endpoint in front of it would re-implement that
 * check in TypeScript and add a second place for it to be wrong.
 *
 * The pieces are resolved against the catalogue the store already holds, so a
 * vault card costs no extra request — and a product deleted since the save is
 * simply reported as missing rather than substituted.
 */

/** A saved_looks row. `select('*')` and optional fields on purpose: a database
 *  that has 0024 but not yet 0025 has no match_score column, and a card
 *  without a score is better than a section that fails to load. */
type VaultRow = {
  id: string
  title?: string | null
  notes?: string | null
  product_ids?: string[] | null
  created_at?: string | null
  match_score?: number | null
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: VaultRow[] }
  | { kind: 'failed' }
  /** 0024 has not been applied — nothing is broken, the feature is not set up. */
  | { kind: 'unconfigured' }

/** `compact` is the account drawer: a fixed panel, so .panel-gold (no lift)
 *  and a single column, which is all 448px has room for. */
export function CuratedVaults({ compact = false }: { compact?: boolean }) {
  const { currentUser, t, pushToast } = useStore()
  const [state, setState] = useState<State>({ kind: 'loading' })

  const userId = currentUser?.id

  const load = useCallback(async () => {
    if (!userId) return
    setState({ kind: 'loading' })
    const { data, error } = await createClient()
      .from('saved_looks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      const missing = error.code === '42P01' || error.code === 'PGRST205'
      if (!missing) console.error('[vaults] could not read saved looks:', error.message)
      setState({ kind: missing ? 'unconfigured' : 'failed' })
      return
    }
    setState({ kind: 'ready', rows: (data ?? []) as VaultRow[] })
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(id: string) {
    // Optimistic: the row is gone from the list before the round trip, and put
    // back if the delete fails. Waiting on the network to remove something the
    // customer just deleted reads as a broken button.
    const previous = state
    if (state.kind === 'ready') {
      setState({ kind: 'ready', rows: state.rows.filter((r) => r.id !== id) })
    }
    const { error } = await createClient().from('saved_looks').delete().eq('id', id)
    if (error) {
      console.error('[vaults] delete failed:', error.message)
      setState(previous)
      pushToast({ title: t('vault.deleteFailed'), variant: 'default' })
      return
    }
    // Also drop it from this browser's own list, so a capsule deleted from the
    // account does not reappear as a guest reference.
    forgetLook(id)
    pushToast({ title: t('vault.deleted'), variant: 'success' })
  }

  return (
    <section className={compact ? 'panel-gold p-4' : 'card-gold p-5'}>
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-lg font-medium text-foreground">
            <Bookmark className="size-4 text-gold" strokeWidth={1.5} />
            {t('vault.title')}
          </h2>
          <p className="mt-1 text-[12px] font-light leading-relaxed text-muted-foreground">
            {t('vault.lead')}
          </p>
        </div>
        <Link
          href="/stylist"
          className="tap-safe hidden shrink-0 items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-gold/80 transition hover:text-gold sm:flex"
        >
          <Sparkles className="size-3.5" strokeWidth={1.5} />
          {t('vault.styleNew')}
        </Link>
      </header>

      {state.kind === 'loading' && (
        <div className="flex items-center justify-center py-12" role="status" aria-busy="true">
          <Loader2 className="size-5 animate-spin text-gold" />
        </div>
      )}

      {state.kind === 'failed' && (
        <div className="py-10 text-center">
          <p className="text-[13px] font-light text-muted-foreground">{t('vault.loadFailed')}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 border border-border px-5 py-2.5 text-[11px] uppercase tracking-[0.12em] text-foreground transition hover:border-gold/50 hover:text-gold"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {state.kind === 'unconfigured' && (
        <p className="py-10 text-center text-[13px] font-light text-muted-foreground">
          {t('looks.notConfigured')}
        </p>
      )}

      {state.kind === 'ready' && state.rows.length === 0 && <EmptyVaults />}

      {state.kind === 'ready' && state.rows.length > 0 && (
        <ul className={compact ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
          {state.rows.map((row) => (
            <VaultCard key={row.id} row={row} onDelete={() => void remove(row.id)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function EmptyVaults() {
  const { t } = useStore()
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <Bookmark className="size-8 text-muted-foreground/25" strokeWidth={1.25} />
      <p className="max-w-xs text-[13px] font-light leading-relaxed text-muted-foreground">
        {t('vault.empty')}
      </p>
      <Link
        href="/stylist"
        className="border border-gold/40 bg-gold/5 px-6 py-3 text-[11px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
      >
        {t('vault.emptyCta')}
      </Link>
    </div>
  )
}

/** Filler tiles for a capsule of fewer than four pieces. */
const PLACEHOLDERS = [0, 1, 2, 3]

function VaultCard({ row, onDelete }: { row: VaultRow; onDelete: () => void }) {
  const { t, tf, localize, products, locale } = useStore()
  // Two-step delete instead of a confirmation dialog: an overlay over a card
  // in a grid is a heavier interruption than the action deserves, and a
  // second click on the same button is unmistakable.
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const id = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(id)
  }, [confirming])

  const ids = row.product_ids ?? []
  const found: Product[] = []
  for (const id of ids) {
    const product = products.find((p) => p.id === id)
    if (product) found.push(product)
  }
  const missing = ids.length - found.length
  const total = found.reduce((sum, p) => sum + p.price, 0)

  let date = ''
  if (row.created_at) {
    try {
      date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
        .format(new Date(row.created_at))
    } catch {
      date = row.created_at.slice(0, 10)
    }
  }

  return (
    <li className="group flex flex-col border border-border/60 transition-colors duration-300 hover:border-gold/40">
      {/* The capsule at a glance: up to four pieces, in the order they were
          saved. A link, so the whole strip opens the capsule. */}
      <Link
        href={`/stylist/share/${encodeURIComponent(row.id)}`}
        className="grid grid-cols-4 gap-px bg-border/40"
        aria-label={t('vault.open')}
      >
        {found.slice(0, 4).map((p) => (
          <span key={p.id} className="relative block aspect-[3/4] overflow-hidden bg-background">
            <Image
              src={p.image}
              alt={localize(p.name)}
              fill
              sizes="120px"
              className="size-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
            />
          </span>
        ))}
        {/* Placeholders keep the strip rectangular for a two-piece capsule and
            for pieces the catalogue no longer carries. */}
        {PLACEHOLDERS.slice(0, Math.max(0, 4 - found.length)).map((i) => (
          <span key={`gap-${i}`} className="block aspect-[3/4] bg-background/60" />
        ))}
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-serif text-[15px] font-medium text-foreground">
              {row.title?.trim() || t('looks.capsule')}
            </p>
            <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60">
              {tf('vault.pieces', { n: found.length })}
              {date && ` · ${date}`}
            </p>
          </div>
          {/* Only when the engine recorded one — never a fabricated number. */}
          {typeof row.match_score === 'number' && (
            <span className="shrink-0 border border-gold/40 bg-gold/[0.06] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-gold">
              {tf('vault.match', { n: row.match_score })}
            </span>
          )}
        </div>

        {row.notes?.trim() && (
          <p className="line-clamp-2 text-[12px] font-light leading-relaxed text-muted-foreground">
            {row.notes}
          </p>
        )}

        {missing > 0 && (
          <p className="text-[11px] font-light text-muted-foreground/60">
            {tf('vault.missing', { n: missing })}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          <span className="text-[13px] font-light text-gold">{formatPrice(total)}</span>
          <div className="flex items-center gap-2">
            <Link
              href={`/stylist/share/${encodeURIComponent(row.id)}`}
              className="border border-gold/30 bg-gold/5 px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
            >
              {t('vault.open')}
            </Link>
            <button
              type="button"
              onClick={() => (confirming ? onDelete() : setConfirming(true))}
              aria-label={t('vault.delete')}
              className={cn(
                'tap-safe flex items-center gap-1.5 border px-3 py-2 text-[11px] uppercase tracking-[0.12em] transition-colors duration-200',
                confirming
                  ? 'border-destructive/60 bg-destructive/10 text-destructive'
                  : 'border-border/60 text-muted-foreground hover:border-destructive/50 hover:text-destructive',
              )}
            >
              <Trash2 className="size-3.5" strokeWidth={1.5} />
              {confirming && t('vault.confirmDelete')}
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}
