'use client'

import { ImagePlus, Loader2, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { adminLocalize as localize, adminT as t } from '@/lib/admin-i18n'
import { subcategoryCover } from '@/lib/subcategory-cover'
import { CORE_DEPARTMENTS } from '@/lib/departments'
import { useFullCatalog, useStore } from '@/lib/store'
import type { Category, CategoryGroupKey, Collection, LocalizedText, Product } from '@/lib/types'
import { AdminPageHeader } from './admin-shell'
import { ConfirmDialog } from './confirm-dialog'

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
      pushToast({ title: (e as Error).message, variant: 'error' })
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
            className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50"
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
  // Counts per collection need every product; see AdminPanel.
  const { products } = useFullCatalog()
  const {
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
      <AdminPageHeader title={t('admin.collections')} description={t('admin.departmentsHint')} />

      {/* The three core departments, offered until each one exists. */}
      <MissingDepartments onCreated={reloadCatalog} />

      <NewCollectionForm onCreated={reloadCatalog} />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {categoryTree.map(({ group }) => (
          <CategorySlot
            key={group}
            group={group}
            row={collections.find((c) => c.slug === group)}
            count={products.filter((p) => p.group === group).length}
            onSale={products.filter((p) => p.group === group && p.listing?.status === 'published').length}
            label={localize(groupLabels[group] ?? {})}
            image={categoryImages[group] ?? ''}
            isCustom={Boolean(categoryImages[group])}
            onSaved={reloadCatalog}
            onChange={(image) => {
              void setCategoryImage(group, image)
              pushToast({ title: 'Изображение раздела обновлено', variant: 'success' })
            }}
            onReset={() => {
              void resetCategoryImage(group)
              pushToast({ title: 'Своё фото раздела убрано', variant: 'default' })
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
                      pushToast({ title: data?.error ?? 'Не удалось удалить', variant: 'error' })
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

      <CategoriesPanel products={products} onChanged={reloadCatalog} />
    </div>
  )
}

function CategorySlot({
  group,
  row,
  label,
  count,
  onSale,
  image,
  isCustom,
  onChange,
  onReset,
  onDelete,
  onSaved,
}: {
  group: CategoryGroupKey
  /** The database row; absent for a department not created yet. */
  row?: Collection
  label: string
  count: number
  /** Of `count`, how many are published — the storefront shows the
   *  department only when this is above zero. */
  onSale: number
  image: string
  isCustom: boolean
  onChange: (image: string) => void
  onReset: () => void
  /** Present only when the collection is empty and therefore deletable. */
  onDelete?: () => Promise<void>
  onSaved: () => Promise<void> | void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
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
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative aspect-[4/5] overflow-hidden bg-background">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={label} className="size-full object-cover" />
        ) : (
          // No photo of its own: the storefront card shows its bundled artwork
          // or a plain panel; here, the initial.
          <span aria-hidden className="flex size-full items-center justify-center text-5xl font-medium text-muted-foreground/60">
            {label.trim().charAt(0).toUpperCase()}
          </span>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <p className="text-xs text-muted-foreground">
            {count} {count === 1 ? 'товар' : 'товаров'} · в продаже {onSale}
          </p>
          <h3 className="text-lg font-semibold text-foreground">{label}</h3>
          {onSale === 0 && (
            <p className="mt-1 text-[11px] text-amber-800">Не показан в магазине: нет опубликованных товаров</p>
          )}
        </div>
        {isCustom && (
          <span className="absolute left-3 top-3 rounded-md border border-border bg-background/90 px-2 py-0.5 text-[11px] text-foreground">
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
          className="flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-sm text-foreground transition hover:bg-accent disabled:cursor-wait disabled:opacity-60"
        >
          <ImagePlus className="size-3.5" />
          {uploading ? 'Загрузка...' : 'Заменить фото'}
        </button>
        {isCustom && (
          <button
            type="button"
            onClick={onReset}
            className="flex min-h-[36px] items-center justify-center rounded-lg border border-border px-3 text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
            title="Вернуть изображение по умолчанию"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
        {row && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            className="flex min-h-[36px] items-center justify-center rounded-lg border border-border px-3 text-muted-foreground transition hover:text-foreground"
            title="Название, порядок и описание"
            aria-label={`Изменить раздел «${label}»`}
          >
            <Pencil className="size-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            // Irreversible, and only offered while the section holds no
            // products, so one confirmation is proportionate.
            onClick={() => setConfirmDelete(true)}
            className="flex min-h-[36px] items-center justify-center rounded-lg border border-border px-3 text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
            title="Удалить раздел"
            aria-label={`Удалить раздел «${label}»`}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {editing && row && (
        <div className="border-t border-border p-3">
          <TaxonomyEditForm
            name={row.name}
            sortOrder={row.sortOrder}
            description={row.description ?? ({} as LocalizedText)}
            onCancel={() => setEditing(false)}
            onSave={async (patch) => {
              const res = await fetch('/api/admin/collections', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slug: row.slug, ...patch }),
              })
              const data = await res.json().catch(() => ({}))
              if (!res.ok) throw new Error(data?.error ?? 'Не удалось сохранить раздел')
              pushToast({ title: `Раздел «${label}» сохранён`, variant: 'success' })
              setEditing(false)
              await onSaved()
            }}
          />
        </div>
      )}
      {onDelete && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Удалить раздел «${label}»?`}
          description="Раздел пустой — товаров в нём нет. Он исчезнет из меню магазина. Отменить нельзя."
          confirmLabel="Удалить раздел"
          onConfirm={() => {
            setConfirmDelete(false)
            void onDelete()
          }}
        />
      )}
    </div>
  )
}

/**
 * The categories inside each collection — what the storefront filters, the
 * category pages and the product form's picker are built from. All of them
 * read the database, so a category added here appears everywhere without a
 * deploy. Only an empty category can be removed (products.category_id is ON
 * DELETE RESTRICT).
 *
 * Each one also carries the cover of its card on the department page
 * (components/products/subcategory-cards.tsx): the preview here is exactly
 * what the storefront shows — the chosen cover, else the subcategory's best
 * product photo, else its initial (lib/subcategory-cover.ts).
 */
function CategoriesPanel({
  products,
  onChanged,
}: {
  /** The full catalogue: counts, and the product photo a card falls back to. */
  products: Product[]
  onChanged: () => Promise<void> | void
}) {
  const { categoryTree, groupLabels, categoryLabel, collections, categories, pushToast } = useStore()
  const [addingTo, setAddingTo] = useState<string | null>(null)

  const [pendingRemove, setPendingRemove] = useState<{ group: string; slug: string; label: string } | null>(null)

  async function remove(group: string, slug: string) {
    setPendingRemove(null)
    // With its department: since 0040 the same slug exists in each one.
    const res = await fetch(
      `/api/admin/categories?slug=${encodeURIComponent(slug)}&collection=${encodeURIComponent(group)}`,
      { method: 'DELETE' },
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      pushToast({ title: data?.error ?? 'Не удалось удалить категорию', variant: 'error' })
      return
    }
    pushToast({ title: 'Категория удалена', variant: 'success' })
    await onChanged()
  }

  return (
    <section className="mt-10">
      <h2 className="mb-2 text-lg font-semibold text-foreground">Категории</h2>
      <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
        По категориям работают фильтры магазина и выбор категории в карточке товара. Названия — на
        всех языках сайта; пустой язык показывает русское название. Обложка — фото на карточке
        категории на странице раздела; если её нет, берётся фото товара из этой категории.
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

              {items.length === 0 ? (
                <span className="text-xs text-muted-foreground/85">Категорий пока нет</span>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((slug) => {
                    const row = categories.find((c) => c.collectionSlug === group && c.slug === slug)
                    const inIt = products.filter((p) => p.group === group && p.category === slug)
                    const count = inIt.length
                    return (
                      <CategoryTile
                        key={slug}
                        group={group}
                        slug={slug}
                        row={row}
                        label={localize(categoryLabel(group, slug)) || slug}
                        count={count}
                        onSale={inIt.filter((p) => p.listing?.status === 'published').length}
                        cover={subcategoryCover(categories, products, group, slug)}
                        onRemove={row && count === 0 ? async (g, sl, lb) => setPendingRemove({ group: g, slug: sl, label: lb }) : undefined}
                        onChanged={onChanged}
                      />
                    )
                  })}
                </ul>
              )}

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
      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title={`Удалить категорию «${pendingRemove?.label ?? ''}»?`}
        description="В категории нет товаров. Она исчезнет из фильтров магазина и из выбора в карточке товара. Отменить нельзя."
        confirmLabel="Удалить категорию"
        onConfirm={() => pendingRemove && void remove(pendingRemove.group, pendingRemove.slug)}
      />
    </section>
  )
}

/** One category: its card's cover (preview, upload, remove), name, slug, count. */
function CategoryTile({
  group,
  slug,
  row,
  label,
  count,
  onSale,
  cover,
  onRemove,
  onChanged,
}: {
  group: string
  slug: string
  /** The database row. */
  row?: Category
  label: string
  count: number
  /** Of `count`, how many are published: shown in the shop only above zero. */
  onSale: number
  cover: ReturnType<typeof subcategoryCover>
  onRemove?: (group: string, slug: string, label: string) => Promise<void>
  onChanged: () => Promise<void> | void
}) {
  const { pushToast } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'upload' | 'clear' | null>(null)
  const [editing, setEditing] = useState(false)
  // A photo that fails to load shows the initial, as the storefront card does.
  const [broken, setBroken] = useState<string | null>(null)
  const preview = cover.src && cover.src !== broken ? cover.src : null

  async function save(image: string | null) {
    if (!row) return
    const res = await fetch('/api/admin/categories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, image }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error ?? 'Не удалось сохранить обложку')
    await onChanged()
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      pushToast({ title: `«${file.name}» не является изображением`, variant: 'default' })
      return
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      pushToast({ title: `«${file.name}» слишком большой (максимум ${MAX_FILE_SIZE_MB} МБ)`, variant: 'default' })
      return
    }
    setBusy('upload')
    try {
      await save(await uploadCover(file))
      pushToast({ title: `Обложка «${label}» обновлена`, variant: 'success' })
    } catch (err) {
      pushToast({ title: (err as Error).message, variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function clear() {
    setBusy('clear')
    try {
      await save(null)
      pushToast({ title: `Своя обложка «${label}» убрана`, variant: 'default' })
    } catch (err) {
      pushToast({ title: (err as Error).message, variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="min-w-0 rounded-xl border border-border bg-background/60 p-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-secondary">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt=""
              onError={() => setBroken(preview)}
              className={`size-full object-cover ${cover.source === 'product' ? 'mix-blend-multiply' : ''}`}
            />
          ) : (
            <span className="flex size-full items-center justify-center text-lg font-medium text-muted-foreground">
              {label.trim().charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 basis-28">
          <p className="truncate text-sm text-foreground">{label}</p>
          <p className="break-words font-mono text-[10px] text-muted-foreground/85">
            {slug} · {count} · в продаже {onSale}
          </p>
          {onSale === 0 && <p className="text-[11px] text-amber-800">Не показана в магазине</p>}
          <p
            className={`mt-0.5 text-[11px] ${cover.source === 'custom' ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            {cover.source === 'custom' ? 'Своя обложка' : cover.source === 'product' ? 'Фото товара' : 'Без фото'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {row && (
            <>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null}
                title={cover.source === 'custom' ? 'Заменить обложку' : 'Загрузить обложку'}
                aria-label={`${cover.source === 'custom' ? 'Заменить' : 'Загрузить'} обложку «${label}»`}
                className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:border-gold/50 hover:text-gold disabled:opacity-50"
              >
                {busy === 'upload' ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
              </button>
              {cover.source === 'custom' && (
                <button
                  type="button"
                  onClick={() => void clear()}
                  disabled={busy !== null}
                  title="Убрать свою обложку (вернуть фото товара)"
                  aria-label={`Убрать свою обложку «${label}»`}
                  className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
                >
                  {busy === 'clear' ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                </button>
              )}
            </>
          )}
          {row && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
              title="Название и порядок"
              aria-label={`Изменить категорию «${label}»`}
              className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:text-foreground"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={() => void onRemove(group, slug, label)}
              title="Удалить категорию"
              aria-label={`Удалить категорию ${label}`}
              className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {editing && row && (
        <div className="mt-3 border-t border-border pt-3">
          <TaxonomyEditForm
            name={row.name}
            sortOrder={row.sortOrder}
            onCancel={() => setEditing(false)}
            onSave={async (patch) => {
              const res = await fetch('/api/admin/categories', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: row.id, ...patch }),
              })
              const data = await res.json().catch(() => ({}))
              if (!res.ok) throw new Error(data?.error ?? 'Не удалось сохранить категорию')
              pushToast({ title: `Категория «${label}» сохранена`, variant: 'success' })
              setEditing(false)
              await onChanged()
            }}
          />
        </div>
      )}
    </li>
  )
}

/**
 * Renaming and reordering a department or a category, and a department's
 * short description. The slug is not here: it is in every link and on every
 * product, so it stays what it was created as.
 */
function TaxonomyEditForm({
  name,
  sortOrder,
  description,
  onSave,
  onCancel,
}: {
  name: LocalizedText
  sortOrder: number
  /** Departments only; a category has none. */
  description?: LocalizedText
  onSave: (patch: { name: Record<string, string>; sortOrder: number; description?: Record<string, string> }) => Promise<void>
  onCancel: () => void
}) {
  const { pushToast } = useStore()
  const [names, setNames] = useState<Record<string, string>>({ ...name })
  const [order, setOrder] = useState(String(sortOrder))
  const [texts, setTexts] = useState<Record<string, string>>({ ...(description ?? {}) })
  const [busy, setBusy] = useState(false)
  const orderValid = /^-?\d{1,4}$/.test(order.trim())

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !orderValid || !(names.ru ?? '').trim()) return
    setBusy(true)
    try {
      await onSave({
        name: names,
        sortOrder: Number(order.trim()),
        ...(description !== undefined ? { description: texts } : {}),
      })
    } catch (err) {
      pushToast({ title: (err as Error).message, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {CATEGORY_NAME_FIELDS.map((field) => (
          <label key={field.locale} className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Название {field.label}
              {field.required && <span className="text-destructive"> *</span>}
            </span>
            <input
              type="text"
              value={names[field.locale] ?? ''}
              maxLength={60}
              required={field.required}
              onChange={(e) => setNames((prev) => ({ ...prev, [field.locale]: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold"
            />
          </label>
        ))}
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Порядок (меньше — выше)</span>
          <input
            type="number"
            inputMode="numeric"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold"
          />
        </label>
      </div>
      {description !== undefined && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[11px] font-medium text-muted-foreground">
            Короткое описание под заголовком раздела (необязательно; только то, что правда)
          </legend>
          {CATEGORY_NAME_FIELDS.map((field) => (
            <label key={field.locale} className="block">
              <span className="sr-only">Описание {field.label}</span>
              <textarea
                rows={2}
                maxLength={600}
                placeholder={field.label}
                value={texts[field.locale] ?? ''}
                onChange={(e) => setTexts((prev) => ({ ...prev, [field.locale]: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold"
              />
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !orderValid || !(names.ru ?? '').trim()}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Сохранить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          Отмена
        </button>
      </div>
    </form>
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
      pushToast({ title: (err as Error).message, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 border-t border-border pt-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {CATEGORY_NAME_FIELDS.map((field) => (
          <label key={field.locale} className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
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
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
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
      <p className="mt-2 text-[11px] text-muted-foreground/85">
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
      pushToast({ title: (e as Error).message, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-6 flex min-h-[38px] items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition hover:bg-foreground/85"
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
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
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
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
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
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
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
