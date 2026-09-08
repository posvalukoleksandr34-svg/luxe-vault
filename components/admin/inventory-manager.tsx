'use client'

import { AlertTriangle, Boxes, Download, Grid3x3, List, Loader2, Search, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * Stock across the whole catalogue.
 *
 * The product form edits one product's size × colour grid, which is right for
 * setting a product up and wrong for the daily question: what am I about to
 * run out of. This is that view — every variant, urgency first, editable in
 * place.
 *
 * Edits are absolute values, not deltas: the admin is looking at a shelf and
 * typing what is on it. Each save is its own request rather than a batch, so a
 * single bad value cannot roll back a morning's counting.
 */

type Variant = {
  id: string
  slug: string
  name: string
  image: string
  size: string
  color: string
  sku?: string
  stock: number
  lowStockAt: number
  state: 'out' | 'low' | 'ok'
}

type StateFilter = 'all' | 'low' | 'out'

export function InventoryManager() {
  const { pushToast } = useStore()

  const [variants, setVariants] = useState<Variant[]>([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [query, setQuery] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [savingId, setSavingId] = useState<string | null>(null)
  /** Local edits, keyed by variant id, so typing does not fight the fetched
   *  value and an unsaved change is visibly distinct from a saved one. */
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  /** Table = every variant with its exact count. Matrix = one row per product
   *  and colour, one column per size, each cell a single click that flips the
   *  size in or out of stock. The matrix is for the daily "we sold out of
   *  mediums" edit; the table is for entering real numbers. */
  const [view, setView] = useState<'table' | 'matrix'>('table')
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    try {
      const res = await fetch('/api/admin/inventory')
      if (!res.ok) return
      const data = await res.json()
      setVariants(data.variants ?? [])
      setUnavailable(Boolean(data.unavailable))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const counts = useMemo(
    () => ({
      total: variants.length,
      low: variants.filter((v) => v.state === 'low').length,
      out: variants.filter((v) => v.state === 'out').length,
      units: variants.reduce((sum, v) => sum + v.stock, 0),
    }),
    [variants],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return variants.filter((v) => {
      if (stateFilter !== 'all' && v.state !== stateFilter) return false
      if (!q) return true
      return (
        v.name.toLowerCase().includes(q) ||
        v.slug.toLowerCase().includes(q) ||
        (v.sku ?? '').toLowerCase().includes(q) ||
        `${v.size} ${v.color}`.toLowerCase().includes(q)
      )
    })
  }, [variants, query, stateFilter])

  async function save(v: Variant) {
    const raw = drafts[v.id]
    if (raw === undefined) return

    const next = Math.max(0, Math.trunc(Number(raw) || 0))
    if (next === v.stock) {
      setDrafts((d) => {
        const copy = { ...d }
        delete copy[v.id]
        return copy
      })
      return
    }

    setSavingId(v.id)
    try {
      const res = await fetch('/api/admin/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, stock: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        pushToast({ title: data.error ?? 'Не удалось сохранить', variant: 'default' })
        return
      }
      setDrafts((d) => {
        const copy = { ...d }
        delete copy[v.id]
        return copy
      })
      // Refetched rather than patched locally, because `state` is computed
      // server-side and a stale badge beside a fresh number is confusing.
      await load()
    } finally {
      setSavingId(null)
    }
  }

  /**
   * Flips one size in or out of stock with a single click.
   *
   * Out is unambiguous: stock 0. Back in is not — the matrix has no idea how
   * many arrived — so it lifts a zero to 1 and leaves any real count alone.
   * Same rule as the CSV import, so the two cannot disagree.
   */
  async function toggleStock(v: Variant) {
    const next = v.stock > 0 ? 0 : 1
    setSavingId(v.id)
    try {
      const res = await fetch('/api/admin/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, stock: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        pushToast({ title: data.error ?? 'Не удалось сохранить', variant: 'default' })
        return
      }
      await load()
    } finally {
      setSavingId(null)
    }
  }

  async function importCsv(file: File) {
    setImporting(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/admin/inventory/import', { method: 'POST', body })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        pushToast({ title: data.error ?? 'Импорт не удался', variant: 'default' })
        return
      }

      // Skipped rows are reported, not swallowed: an import that says "done"
      // while ignoring half the file is how a shop finds out at the till.
      const skipped =
        (data.rejected?.length ?? 0) +
        (data.unknownProducts?.length ?? 0) +
        (data.missingVariants?.length ?? 0)

      pushToast({
        title: `Обновлено позиций: ${data.updated}`,
        description: skipped > 0 ? `Пропущено строк: ${skipped}` : undefined,
        variant: skipped > 0 ? 'default' : 'success',
      })

      if (skipped > 0) {
        console.warn('[inventory import] skipped rows:', {
          rejected: data.rejected,
          unknownProducts: data.unknownProducts,
          missingVariants: data.missingVariants,
        })
      }

      await load()
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /**
   * One row per product and colour, one column per size.
   *
   * Derived from the same `variants` the table uses rather than fetched
   * separately, so both views always agree. Sizes are ordered S–XL where they
   * are recognised and alphabetically otherwise, because a matrix whose
   * columns read L, M, S, XL is harder to scan than one that reads S, M, L, XL.
   */
  const matrix = useMemo(() => {
    const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']
    const rank = (s: string) => {
      const i = SIZE_ORDER.indexOf(s.toUpperCase())
      return i < 0 ? SIZE_ORDER.length : i
    }

    const sizes = Array.from(new Set(filtered.map((v) => v.size))).sort(
      (a, b) => rank(a) - rank(b) || a.localeCompare(b),
    )

    const rows = new Map<string, { name: string; slug: string; color: string; cells: Map<string, Variant> }>()
    for (const v of filtered) {
      const key = `${v.slug}|${v.color}`
      if (!rows.has(key)) {
        rows.set(key, { name: v.name, slug: v.slug, color: v.color, cells: new Map() })
      }
      rows.get(key)!.cells.set(v.size, v)
    }

    return { sizes, rows: Array.from(rows.values()) }
  }, [filtered])

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-gold" />
      </div>
    )
  }

  if (unavailable) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <Boxes className="mx-auto mb-3 size-6 text-muted-foreground/30" strokeWidth={1.25} />
        <p className="text-[13px] text-muted-foreground">
          Учёт остатков не настроен. Примените миграцию 0012_inventory.sql.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-6">
          <Stat label="Позиций" value={String(counts.total)} />
          <Stat label="Единиц" value={String(counts.units)} />
          <Stat label="Заканчивается" value={String(counts.low)} tone={counts.low ? 'warn' : undefined} />
          <Stat label="Нет в наличии" value={String(counts.out)} tone={counts.out ? 'bad' : undefined} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* CSV round trip. Export produces exactly the shape import accepts,
              so the workflow is edit-in-Excel-and-upload rather than
              hand-building a file to match a format documented elsewhere. */}
          <a
            href="/api/admin/inventory/import"
            download
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground transition hover:border-gold/50 hover:text-foreground"
          >
            <Download className="size-3.5" />
            Экспорт CSV
          </a>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void importCsv(file)
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground transition hover:border-gold/50 hover:text-foreground disabled:opacity-50"
          >
            {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Импорт CSV
          </button>

          <div className="flex rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setView('table')}
              aria-pressed={view === 'table'}
              title="Таблица с количеством"
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-[12px] transition',
                view === 'table' ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <List className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView('matrix')}
              aria-pressed={view === 'matrix'}
              title="Матрица размеров"
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-[12px] transition',
                view === 'matrix' ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Grid3x3 className="size-3.5" />
            </button>
          </div>

          <div className="flex rounded-lg border border-border">
            {(['all', 'low', 'out'] as StateFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStateFilter(s)}
                className={cn(
                  'px-3 py-2 text-[12px] transition',
                  stateFilter === s ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s === 'all' ? 'Все' : s === 'low' ? 'Мало' : 'Нет'}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Товар, SKU, размер"
              aria-label="Поиск по остаткам"
              className="w-52 rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-[13px] text-foreground outline-none focus:border-gold"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Boxes className="size-6 text-muted-foreground/25" strokeWidth={1.25} />
          <p className="text-[13px] text-muted-foreground">
            {variants.length === 0
              ? 'Остатки ещё не заданы — укажите их в карточке товара'
              : 'Ничего не найдено'}
          </p>
        </div>
      ) : (
        view === 'matrix' ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-background/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-normal">Товар</th>
                  <th className="px-4 py-3 font-normal">Цвет</th>
                  {matrix.sizes.map((size) => (
                    <th key={size} className="px-2 py-3 text-center font-normal">
                      {size}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={`${row.slug}-${row.color}`} className="border-t border-border/60">
                    <td className="px-4 py-2.5">
                      <span className="block truncate text-foreground">{row.name}</span>
                      <span className="block font-mono text-[10px] text-muted-foreground/60">
                        {row.slug}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                      {row.color}
                    </td>
                    {matrix.sizes.map((size) => {
                      const v = row.cells.get(size)
                      // A blank cell means this product has no such variant —
                      // visibly different from one that exists and is sold out,
                      // which is a state an admin needs to be able to tell apart.
                      if (!v) {
                        return (
                          <td key={size} className="px-2 py-2.5 text-center text-muted-foreground/25">
                            —
                          </td>
                        )
                      }
                      const inStock = v.stock > 0
                      return (
                        <td key={size} className="px-2 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => toggleStock(v)}
                            disabled={savingId === v.id}
                            aria-pressed={inStock}
                            title={`${row.name} · ${row.color} · ${size} — ${inStock ? `в наличии (${v.stock})` : 'нет в наличии'}`}
                            className={cn(
                              'min-w-11 rounded border px-2 py-1.5 text-[11px] tabular-nums transition disabled:opacity-50',
                              inStock
                                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400 hover:border-emerald-400/60'
                                : 'border-red-400/30 bg-red-400/10 text-red-400 line-through hover:border-red-400/60',
                            )}
                          >
                            {savingId === v.id ? '…' : inStock ? v.stock : 0}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[44rem] text-left text-[13px]">
            <thead className="bg-background/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-normal">Товар</th>
                <th className="px-4 py-3 font-normal">Вариант</th>
                <th className="px-4 py-3 font-normal">SKU</th>
                <th className="px-4 py-3 font-normal">Остаток</th>
                <th className="px-4 py-3 font-normal">Статус</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const draft = drafts[v.id]
                const dirty = draft !== undefined && Number(draft) !== v.stock
                return (
                  <tr key={v.id} className="border-t border-border/60">
                    <td className="px-4 py-3">
                      <span className="block truncate text-foreground">{v.name}</span>
                      <span className="block font-mono text-[10px] text-muted-foreground/60">
                        {v.slug}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {v.size} · {v.color}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground/70">
                      {v.sku ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          value={draft ?? String(v.stock)}
                          onChange={(e) => setDrafts((d) => ({ ...d, [v.id]: e.target.value }))}
                          onBlur={() => save(v)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                          }}
                          aria-label={`${v.name} ${v.size} ${v.color}`}
                          className={cn(
                            'w-20 rounded border bg-background px-2 py-1.5 text-center tabular-nums text-foreground outline-none transition',
                            dirty ? 'border-gold' : 'border-border focus:border-gold',
                          )}
                        />
                        {savingId === v.id && (
                          <Loader2 className="size-3.5 animate-spin text-gold" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge state={v.state} lowAt={v.lowStockAt} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )
      )}

      <p className="mt-3 text-[11px] text-muted-foreground/60">
        {view === 'matrix'
          ? 'Клик по размеру переключает наличие. «В наличии» ставит 1, если было 0, и не трогает реальный остаток. «—» означает, что такого варианта у товара нет.'
          : 'Изменения сохраняются при уходе с поля или по Enter. Остаток уменьшается автоматически при оплаченном заказе и возвращается при отмене.'}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground/60">
        CSV: <code className="font-mono">product_id,size,in_stock</code> — например{' '}
        <code className="font-mono">p-hoodie-noir,M,false</code>. Необязательная колонка{' '}
        <code className="font-mono">color</code> ограничивает строку одним цветом; без неё правило
        применяется ко всем цветам этого размера.
      </p>
    </div>
  )
}

function StateBadge({ state, lowAt }: { state: Variant['state']; lowAt: number }) {
  if (state === 'out') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-red-400">
        Нет
      </span>
    )
  }
  if (state === 'low') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-400">
        <AlertTriangle className="size-3" />
        ≤ {lowAt}
      </span>
    )
  }
  return <span className="text-[11px] text-muted-foreground/50">—</span>
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'warn' | 'bad'
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-lg',
          tone === 'bad' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400' : 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}
