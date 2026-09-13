'use client'

import { Languages, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/lib/store'

/**
 * Translates every existing product's name and description into the
 * storefront languages it is missing — see /api/admin/translate-catalog.
 *
 * Runs in small batches, one request each, so a large catalogue never hits a
 * serverless time limit; progress is shown as it goes. Only languages that are
 * empty or still a copy of the Russian text are filled.
 */
export function TranslateCatalogButton() {
  const { pushToast, reloadCatalog } = useStore()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  async function run() {
    if (
      !confirm(
        'Перевести названия и описания всех товаров на недостающие языки?\n\n' +
          'Заполняются только пустые языки и языки, где стоит копия русского текста. ' +
          'Ваши собственные переводы не меняются.',
      )
    ) {
      return
    }

    let offset = 0
    let translated = 0
    let failed = 0
    setProgress({ done: 0, total: 0 })
    try {
      // A ceiling on requests, so an unexpected server answer can never loop.
      for (let i = 0; i < 500; i++) {
        const res = await fetch('/api/admin/translate-catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? 'Не удалось перевести каталог')

        translated += Number(data.translated) || 0
        failed += Array.isArray(data.failed) ? data.failed.length : 0
        offset = Number(data.nextOffset) || offset
        setProgress({ done: offset, total: Number(data.total) || 0 })
        if (data.done) break
      }
      await reloadCatalog()
      pushToast({
        title: `Переведено товаров: ${translated}${failed ? `, с ошибкой: ${failed}` : ''}`,
        variant: failed ? 'default' : 'success',
      })
    } catch (e) {
      pushToast({ title: (e as Error).message, variant: 'default' })
    } finally {
      setProgress(null)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={progress !== null}
      title="Перевести названия и описания товаров на все языки сайта"
      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition hover:border-gold/50 hover:text-gold disabled:cursor-wait disabled:opacity-60"
    >
      {progress ? <Loader2 className="size-4 animate-spin" /> : <Languages className="size-4" />}
      {progress ? `Перевод… ${progress.done}/${progress.total || '…'}` : 'Перевести каталог'}
    </button>
  )
}
