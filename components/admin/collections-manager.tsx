'use client'

import { ImagePlus, Loader2, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { adminLocalize as localize, adminT as t } from '@/lib/admin-i18n'
import { DEFAULT_CATEGORY_IMAGES } from '@/lib/data'
import { CORE_DEPARTMENTS } from '@/lib/departments'
import { useStore } from '@/lib/store'
import type { CategoryGroupKey } from '@/lib/types'

// Mirrors the bucket's own file_size_limit — see lib/server/product-images.ts.
const MAX_FILE_SIZE_MB = 5

/**
 * The core departments (lib/departments.ts) that do not exist in the catalogue
 * yet, each with a one-click create.
 *
 * Nothing is written to the catalogue on its own: a department appears only
 * when someone presses the button here, which posts the same payload the
 * manual form does — so the slug and the five translations are always the ones
 * the storefront's cards and routes expect (/category/women, …).
 */
function MissingDepartments({ onCreated }: { onCreated: () => Promise<void> | void }) {
  const { collections, pushToast } = useStore()
  const [busy, setBusy] = useState<string | null>(null)

  const missing = CORE_DEPARTMENTS.filter((d) => !collections.some((c) => c.slug === d.slug))
  if (missing.length === 0) return null

  async function create(slug: string, name: Record<string, string>, sortOrder: number) {
    if (busy) return
    setBusy(slug)
    try {
      const res = await fetch('/api/admin/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name, sortOrder }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Не удалось создать раздел')
      pushToast({ title: 'Раздел создан', variant: 'success' })
      await onCreated()
    } catch (e) {
      pushToast({ title: (e as Error).message, variant: 'default' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mb-6 border border-gold/30 bg-gold/[0.04] px-4 py-4">
      <p className="mb-3 text-sm text-foreground">{t('admin.departmentMissing')}</p>
      <div className="flex flex-wrap gap-2">
        {missing.map((d) => (
          <button
            key={d.slug}
            type="button"
            disabled={busy !== null}
            onClick={() => void create(d.slug, d.name, d.sortOrder)}
            className="inline-flex items-center gap-2 border border-gold px-4 py-2 text-xs uppercase tracking-wider text-gold transition-colors hover:bg-gold hover:text-gold-foreground disabled:opacity-50"
          >
            {busy === d.slug ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {t('admin.departmentCreate')} «{localize(d.name)}»
          </button>
        ))}
      </div>
    </div>
  )
}

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
        {t('admin.collections')}
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">{t('admin.departmentsHint')}</p>

      {/* The three core departments, offered until each one exists. */}
      <MissingDepartments onCreated={reloadCatalog} />

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
              pushToast({ title: 'Изображение раздела обновлено', variant: 'success' })
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
                    pushToast({ title: 'Раздел удалён', variant: 'default' })
                    await reloadCatalog()
                  }
                : undefined
            }
          />
        ))}
      </div>

      <CategoriesPanel onChanged={reloadCatalog} />
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
              if (confirm(`Удалить раздел «${label}»?`)) void onDelete()
            }}
            className="flex items-center justify-center gap-1.5 border border-border px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
            title="Удалить раздел"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * The categories inside each collection — what the storefront filters, the
 * category pages and the product form's picker are built from. All of them
 * read the database, so a category added here appears everywhere without a
 * deploy. Only an empty category can be removed (products.category_id is ON
 * DELETE RESTRICT).
 */
function CategoriesPanel({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const { categoryTree, groupLabels, categoryLabels, products, collections, categories, pushToast } =
    useStore()
  const [addingTo, setAddingTo] = useState<string | null>(null)

  async function remove(slug: string, label: string) {
    if (!confirm(`Удалить категорию «${label}»?`)) return
    const res = await fetch(`/api/admin/categories?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      pushToast({ title: data?.error ?? 'Не удалось удалить категорию', variant: 'default' })
      return
    }
    pushToast({ title: 'Категория удалена', variant: 'default' })
    await onChanged()
  }

  return (
    <section className="mt-10">
      <h2 className="mb-2 font-serif text-xl font-semibold text-foreground">Категории</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        По категориям работают фильтры магазина и выбор категории в карточке товара. Названия — на
        всех языках сайта; пустой язык показывает русское название.
      </p>

      <div className="space-y-4">
        {categoryTree.map(({ group, items }) => {
          // Categories live in the database; a collection only in the code
          // fallback has no row to attach one to.
          const inDatabase = collections.some((c) => c.slug === group)
          return (
            <div key={group} className="rounded-xl border border-border bg-card/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-foreground">
                  {localize(groupLabels[group] ?? {}) || group}
                </h3>
                {inDatabase && (
                  <button
                    type="button"
                    onClick={() => setAddingTo(addingTo === group ? null : group)}
                    className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-gold/50 hover:text-gold"
                  >
                    <Plus className="size-3" />
                    Категория
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {items.length === 0 && (
                  <span className="text-xs text-muted-foreground/60">Категорий пока нет</span>
                )}
                {items.map((slug) => {
                  const label = localize(categoryLabels[slug] ?? {}) || slug
                  const count = products.filter((p) => p.group === group && p.category === slug).length
                  const deletable = count === 0 && categories.some((c) => c.slug === slug)
                  return (
                    <span
                      key={slug}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground"
                    >
                      {label}
                      <span className="font-mono text-[10px] text-muted-foreground/60">
                        {slug} · {count}
                      </span>
                      {deletable && (
                        <button
                          type="button"
                          onClick={() => void remove(slug, label)}
                          className="text-muted-foreground/60 transition hover:text-destructive"
                          aria-label={`Удалить категорию ${label}`}
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>

              {addingTo === group && (
                <NewCategoryForm
                  collection={group}
                  onDone={async () => {
                    setAddingTo(null)
                    await onChanged()
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

const CATEGORY_NAME_FIELDS = [
  { locale: 'ru', label: 'RU', required: true },
  { locale: 'en', label: 'EN', required: false },
  { locale: 'it', label: 'IT', required: false },
  { locale: 'fr', label: 'FR', required: false },
  { locale: 'de', label: 'DE', required: false },
] as const

/**
 * A new category, named in all five storefront languages. The slug is what
 * products and URLs reference, so, like a collection's, it is set once.
 */
function NewCategoryForm({
  collection,
  onDone,
}: {
  collection: string
  onDone: () => Promise<void> | void
}) {
  const { pushToast } = useStore()
  const [names, setNames] = useState<Record<string, string>>({})
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [busy, setBusy] = useState(false)

  // Suggested from the English name — Cyrillic has no useful ASCII slug.
  function suggestSlug(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection, slug: slug.trim().toLowerCase(), name: names }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Не удалось создать категорию')
      pushToast({ title: 'Категория создана', variant: 'success' })
      await onDone()
    } catch (err) {
      pushToast({ title: (err as Error).message, variant: 'default' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 border-t border-border pt-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {CATEGORY_NAME_FIELDS.map((field) => (
          <label key={field.locale} className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Название {field.label}
              {field.required && <span className="text-destructive"> *</span>}
            </span>
            <input
              type="text"
              value={names[field.locale] ?? ''}
              onChange={(e) => {
                const value = e.target.value
                setNames((prev) => ({ ...prev, [field.locale]: value }))
                if (field.locale === 'en' && !slugEdited) setSlug(suggestSlug(value))
              }}
              required={field.required}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold"
            />
          </label>
        ))}
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Slug <span className="text-destructive">*</span>
          </span>
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setSlugEdited(true)
            }}
            required
            pattern="[a-z0-9]+(_[a-z0-9]+)*"
            title="Строчные латинские буквы и цифры, через подчёркивание"
            placeholder="sunglasses"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-gold"
          />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground/60">
        Slug нельзя изменить после создания — на него ссылаются товары и адреса страниц.
      </p>
      <div className="mt-3 flex gap-3">
        <button
          type="submit"
          disabled={busy || !slug.trim() || !(names.ru ?? '').trim()}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Создать категорию
        </button>
      </div>
    </form>
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
      if (!res.ok) throw new Error(data?.error ?? 'Не удалось создать раздел')

      pushToast({ title: 'Раздел создан', variant: 'success' })
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
        Новый раздел
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
