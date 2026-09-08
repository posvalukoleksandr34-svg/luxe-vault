'use client'

import { ImagePlus, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { DEFAULT_CATEGORY_IMAGES } from '@/lib/data'
import { useStore } from '@/lib/store'
import type { CategoryGroupKey } from '@/lib/types'

// Mirrors the bucket's own file_size_limit — see lib/server/product-images.ts.
const MAX_FILE_SIZE_MB = 5

/** Uploads one collection cover and returns its public URL. Collection covers
 *  went to Storage for the same reason product images did: a base64 cover sat
 *  in the homepage HTML on every single visit. */
async function uploadCover(file: File): Promise<string> {
  const body = new FormData()
  body.append('folder', 'collections')
  body.append('files', file)

  const res = await fetch('/api/admin/uploads', { method: 'POST', body })
  const json = (await res.json().catch(() => null)) as
    | { urls?: string[]; error?: string }
    | null

  if (!res.ok || !json?.urls?.[0]) {
    throw new Error(json?.error || 'Не удалось загрузить изображение')
  }
  return json.urls[0]
}

/** Admin control for the Collections (Collezioni) preview cards shown on
 * the homepage — lets the owner swap each category's cinematic background
 * image without touching code. Live product counts are shown alongside so
 * it's obvious at a glance which categories are actually populated. */
export function CollectionsManager() {
  const {
    products,
    categoryImages,
    setCategoryImage,
    resetCategoryImage,
    localize,
    pushToast,
    collections,
    categoryTree,
    groupLabels,
    reloadCatalog,
  } = useStore()

  return (
    <div>
      <h1 className="mb-2 font-serif text-2xl font-semibold text-foreground">
        Коллекции
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Коллекции магазина и фоновые изображения их карточек на главной.
      </p>

      <NewCollectionForm onCreated={reloadCatalog} />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {categoryTree.map(({ group }) => (
          <CategorySlot
            key={group}
            group={group}
            count={products.filter((p) => p.group === group).length}
            label={localize(groupLabels[group] ?? {})}
            image={categoryImages[group] || DEFAULT_CATEGORY_IMAGES[group]}
            isCustom={Boolean(categoryImages[group])}
            onChange={(image) => {
              void setCategoryImage(group, image)
              pushToast({ title: 'Изображение коллекции обновлено', variant: 'success' })
            }}
            onReset={() => {
              void resetCategoryImage(group)
              pushToast({ title: 'Возвращено изображение по умолчанию', variant: 'default' })
            }}
            onDelete={
              // A collection can only be removed once it is empty: the FK from
              // products is ON DELETE RESTRICT, so offering the button on a
              // populated collection would only ever produce an error.
              products.filter((p) => p.group === group).length === 0 &&
              collections.some((c) => c.slug === group)
                ? async () => {
                    const res = await fetch(
                      `/api/admin/collections?slug=${encodeURIComponent(group)}`,
                      { method: 'DELETE' },
                    )
                    const data = await res.json().catch(() => ({}))
                    if (!res.ok) {
                      pushToast({ title: data?.error ?? 'Не удалось удалить', variant: 'default' })
                      return
                    }
                    pushToast({ title: 'Коллекция удалена', variant: 'default' })
                    await reloadCatalog()
                  }
                : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}

function CategorySlot({
  group,
  label,
  count,
  image,
  isCustom,
  onChange,
  onReset,
  onDelete,
}: {
  group: CategoryGroupKey
  label: string
  count: number
  image: string
  isCustom: boolean
  onChange: (image: string) => void
  onReset: () => void
  /** Present only when the collection is empty and therefore deletable. */
  onDelete?: () => Promise<void>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const { pushToast } = useStore()

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      pushToast({ title: `«${file.name}» не является изображением`, variant: 'default' })
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      pushToast({
        title: `«${file.name}» слишком большой (максимум ${MAX_FILE_SIZE_MB} МБ)`,
        variant: 'default',
      })
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setUploading(true)
    try {
      onChange(await uploadCover(file))
    } catch (err) {
      pushToast({
        title: err instanceof Error ? err.message : 'Не удалось загрузить изображение',
        variant: 'default',
      })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="border border-border bg-card">
      <div className="relative aspect-[4/5] overflow-hidden bg-background">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={label} className="size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/80">
            {count} {count === 1 ? 'товар' : 'товаров'}
          </p>
          <h3 className="font-serif text-xl font-semibold text-foreground">{label}</h3>
        </div>
        {isCustom && (
          <span className="absolute left-3 top-3 border border-gold/50 bg-background/85 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-gold">
            Своё фото
          </span>
        )}
      </div>

      <div className="flex gap-2 border-t border-border p-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex flex-1 items-center justify-center gap-1.5 border border-border py-2 text-xs uppercase tracking-wider text-foreground transition hover:border-gold/50 hover:text-gold disabled:cursor-wait disabled:opacity-60"
        >
          <ImagePlus className="size-3.5" />
          {uploading ? 'Загрузка...' : 'Заменить фото'}
        </button>
        {isCustom && (
          <button
            type="button"
            onClick={onReset}
            className="flex items-center justify-center gap-1.5 border border-border px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
            title="Вернуть изображение по умолчанию"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => {
              // Deleting a collection is irreversible and only offered when it
              // holds no products, so a single confirm is proportionate.
              if (confirm(`Удалить коллекцию «${label}»?`)) void onDelete()
            }}
            className="flex items-center justify-center gap-1.5 border border-border px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
            title="Удалить коллекцию"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Creates a new collection.
 *
 * The slug is the stable identifier products reference, so it is typed once
 * and never editable afterwards — renaming it would orphan every product
 * filed under it. The display name is what changes; that lives in JSONB and
 * can be edited freely.
 */
function NewCollectionForm({ onCreated }: { onCreated: () => Promise<void> | void }) {
  const { pushToast } = useStore()
  const [open, setOpen] = useState(false)
  const [slug, setSlug] = useState('')
  const [nameRu, setNameRu] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [busy, setBusy] = useState(false)

  // Derive a legal slug as the admin types the Russian name, but let them
  // override it. Cyrillic has no useful ASCII slug, so this only helps when
  // they type Latin — otherwise they fill it in themselves.
  function suggestSlug(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: slug.trim().toLowerCase(),
          name: { ru: nameRu.trim(), en: (nameEn || nameRu).trim() },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Не удалось создать коллекцию')

      pushToast({ title: 'Коллекция создана', variant: 'success' })
      setSlug('')
      setNameRu('')
      setNameEn('')
      setOpen(false)
      await onCreated()
    } catch (e) {
      pushToast({ title: (e as Error).message, variant: 'default' })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-6 flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/5 px-4 py-2.5 text-sm font-medium text-gold transition hover:bg-gold hover:text-gold-foreground"
      >
        <Plus className="size-4" />
        Новая коллекция
      </button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 rounded-xl border border-border bg-card/40 p-5"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
            Название (RU)
          </span>
          <input
            type="text"
            value={nameRu}
            onChange={(e) => {
              setNameRu(e.target.value)
              if (!slug) setSlug(suggestSlug(e.target.value))
            }}
            required
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
            Название (EN)
          </span>
          <input
            type="text"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            placeholder={nameRu}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
            Slug (латиницей)
          </span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Только строчные латинские буквы, цифры и дефисы"
            placeholder="new-arrivals"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm text-foreground outline-none focus:border-gold"
          />
        </label>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Slug нельзя изменить после создания — на него ссылаются товары.
      </p>

      <div className="mt-4 flex gap-3">
        <button
          type="submit"
          disabled={busy || !slug.trim() || !nameRu.trim()}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Создать
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          Отмена
        </button>
      </div>
    </form>
  )
}
