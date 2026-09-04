'use client'

import { ImagePlus, Loader2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { CATEGORY_TREE } from '@/lib/data'
import { useStore } from '@/lib/store'
import type { Product, StatusKey } from '@/lib/types'

const STATUS_OPTIONS: { key: StatusKey; label: string }[] = [
  { key: 'in_stock', label: 'В наличии' },
  { key: 'out_of_stock', label: 'Нет в наличии' },
  { key: 'mirror_quality', label: 'Зеркальное качество' },
  { key: 'limited_edition', label: 'Лимитированная серия' },
  { key: 'premium_quality', label: 'Премиум качество' },
]

// "В наличии" and "Нет в наличии" describe the same axis of availability, so
// selecting one always clears the other instead of letting both be active
// at once.
const AVAILABILITY_STATUSES: StatusKey[] = ['in_stock', 'out_of_stock']

// Keep uploaded images reasonably small since they are stored as base64
// strings inside the product record (and cached in localStorage so they
// survive a page reload — see PRODUCTS_STORAGE_KEY in lib/store.tsx).
const MAX_FILE_SIZE_MB = 4
const FALLBACK_IMAGE = '/images/hoodie.png'

/** Reads a File as a base64 data: URL, so it can be stored directly on the
 * product record and rendered with a plain <img src="..."> anywhere in the
 * app — no external storage/bucket required. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function ProductForm({
  product,
  onClose,
}: {
  product: Product | null
  onClose: () => void
}) {
  const { addProduct, updateProduct, pushToast } = useStore()
  const editing = Boolean(product)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const initialName =
    typeof product?.name === 'object' && product?.name !== null
      ? ((product.name as Record<string, string>).ru ?? '')
      : ''

  const initialDesc =
    typeof product?.description === 'object' && product?.description !== null
      ? ((product.description as Record<string, string>).ru ?? '')
      : ''

  const [form, setForm] = useState({
    name: initialName,
    group: product?.group ?? CATEGORY_TREE[0].group,
    category: product?.category ?? CATEGORY_TREE[0].items[0],
    price: product?.price?.toString() ?? '',
    oldPrice: product?.oldPrice?.toString() ?? '',
    sizes: product?.sizes?.join(', ') ?? 'S, M, L, XL',
    images: product?.images?.length ? product.images : product?.image ? [product.image] : [],
    description: initialDesc,
    isNew: product?.isNew ?? false,
    limited: product?.limited ?? false,
    statuses:
      product?.statuses && product.statuses.some((s) => AVAILABILITY_STATUSES.includes(s))
        ? product.statuses
        : [...(product?.statuses ?? []), 'in_stock' as StatusKey],
  })

  const availableCats =
    CATEGORY_TREE.find((n) => n.group === form.group)?.items ?? []

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploading(true)
    try {
      const accepted: string[] = []
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
          pushToast({
            title: `«${file.name}» пропущен — не является изображением`,
            variant: 'default',
          })
          continue
        }
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          pushToast({
            title: `«${file.name}» слишком большой (максимум ${MAX_FILE_SIZE_MB} МБ)`,
            variant: 'default',
          })
          continue
        }
        const dataUrl = await readFileAsDataUrl(file)
        accepted.push(dataUrl)
      }

      if (accepted.length > 0) {
        setForm((prev) => ({ ...prev, images: [...prev.images, ...accepted] }))
        pushToast({
          title: accepted.length === 1 ? 'Изображение загружено' : `Загружено изображений: ${accepted.length}`,
          variant: 'success',
        })
      }
    } finally {
      setUploading(false)
      // Allow re-selecting the same file again later.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function removeImage(index: number) {
    setForm((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }))
  }

  function moveImage(index: number, dir: -1 | 1) {
    const newIndex = index + dir
    if (newIndex < 0 || newIndex >= form.images.length) return
    const next = [...form.images]
    ;[next[index], next[newIndex]] = [next[newIndex], next[index]]
    setForm({ ...form, images: next })
  }

  function toggleStatus(key: StatusKey) {
    setForm((prev) => {
      if (prev.statuses.includes(key)) {
        // Availability ("В наличии" / "Нет в наличии") is a required field —
        // it cannot be switched off entirely, only swapped for its opposite.
        if (AVAILABILITY_STATUSES.includes(key)) return prev
        return { ...prev, statuses: prev.statuses.filter((s) => s !== key) }
      }
      const withoutOpposite = AVAILABILITY_STATUSES.includes(key)
        ? prev.statuses.filter((s) => !AVAILABILITY_STATUSES.includes(s))
        : prev.statuses
      return { ...prev, statuses: [...withoutOpposite, key] }
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const price = Number(form.price) || 0
    const oldPrice = form.oldPrice ? Number(form.oldPrice) : undefined

    const localizedName = {
      ru: form.name,
      en: form.name,
      it: form.name,
      fr: form.name,
      de: form.name,
    }

    const localizedDesc = {
      ru: form.description,
      en: form.description,
      it: form.description,
      fr: form.description,
      de: form.description,
    }

    const images = form.images.length > 0 ? form.images : [FALLBACK_IMAGE]

    const next: Product = {
      id: product?.id ?? `p-${Date.now()}`,
      name: localizedName,
      group: form.group,
      category: form.category,
      price,
      oldPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
      sizes: form.sizes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      colors: product?.colors ?? [{ name: 'Onyx', hex: '#141414' }],
      image: images[0],
      images,
      description: localizedDesc,
      statuses: form.statuses,
      isNew: form.isNew,
      limited: form.limited,
    }

    if (editing) updateProduct(next)
    else addProduct(next)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <form
        onSubmit={handleSubmit}
        className="animate-fade-up relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-popover p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-serif text-xl font-semibold text-foreground">
            {editing ? 'Редактировать товар' : 'Новый товар'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground transition hover:text-foreground"
            aria-label="Закрыть"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4">
          <Input
            label="Название"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
                Группа
              </span>
              <select
                value={form.group}
                onChange={(e) => {
                  const group = e.target.value as typeof form.group
                  const cats =
                    CATEGORY_TREE.find((n) => n.group === group)?.items ?? []
                  setForm({ ...form, group, category: cats[0] })
                }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold"
              >
                {CATEGORY_TREE.map((n) => (
                  <option key={n.group} value={n.group}>
                    {n.group}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
                Категория
              </span>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as typeof form.category })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold"
              >
                {availableCats.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Цена (CHF)"
              type="number"
              value={form.price}
              onChange={(v) => setForm({ ...form, price: v })}
              required
            />
            <Input
              label="Старая цена (CHF)"
              type="number"
              value={form.oldPrice}
              onChange={(v) => setForm({ ...form, oldPrice: v })}
            />
          </div>

          <Input
            label="Размеры (через запятую)"
            value={form.sizes}
            onChange={(v) => setForm({ ...form, sizes: v })}
          />

          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
              Статусы <span className="text-destructive">*</span>
            </span>
            <p className="mb-1.5 text-[11px] text-muted-foreground/60">
              «В наличии» / «Нет в наличии» обязателен и взаимоисключающий
            </p>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => {
                const selected = form.statuses.includes(opt.key)
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => toggleStatus(opt.key)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      selected
                        ? 'border-gold bg-gold/10 text-gold'
                        : 'border-border text-muted-foreground hover:border-foreground/40'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Real file upload — images are read as base64 and stored on the
              product record, then cached in localStorage, so they persist
              across reloads without needing an external image host. */}
          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
              Изображения товара
            </span>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              id="product-image-upload"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background/50 px-4 py-6 text-sm text-muted-foreground transition hover:border-gold/50 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
            >
              {uploading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Загрузка...
                </>
              ) : (
                <>
                  <ImagePlus className="size-4" />
                  Загрузить фото (можно выбрать несколько)
                </>
              )}
            </button>
            <p className="mt-1.5 text-[11px] text-muted-foreground/60">
              JPG, PNG или WebP, до {MAX_FILE_SIZE_MB} МБ на файл. Первое фото в списке ниже становится обложкой товара.
            </p>

            {form.images.length > 0 && (
              <div className="mt-3">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
                  Загруженные фото (первое — обложка)
                </span>
                <div className="flex flex-wrap gap-3">
                  {form.images.map((img, i) => (
                    <div
                      key={`${img.slice(0, 48)}-${i}`}
                      className="group relative overflow-hidden border-2 border-gold/60"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt={`Фото ${i + 1}`} className="size-20 object-cover" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          removeImage(i)
                        }}
                        className="absolute right-0 top-0 flex size-6 items-center justify-center border border-border bg-background text-foreground shadow-sm transition hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
                        aria-label={`Удалить фото ${i + 1}`}
                        title="Удалить фото"
                      >
                        <X className="size-3.5" strokeWidth={2.5} />
                      </button>
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-background/80 px-1 py-0.5">
                        <button
                          type="button"
                          onClick={() => moveImage(i, -1)}
                          className="text-[10px] text-foreground disabled:opacity-30"
                          disabled={i === 0}
                        >
                          ←
                        </button>
                        <span className="text-[10px] text-gold">{i + 1}</span>
                        <button
                          type="button"
                          onClick={() => moveImage(i, 1)}
                          className="text-[10px] text-foreground disabled:opacity-30"
                          disabled={i === form.images.length - 1}
                        >
                          →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
              Описание
            </span>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold"
            />
          </label>

          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.isNew}
                onChange={(e) => setForm({ ...form, isNew: e.target.checked })}
                className="size-4 accent-[var(--gold)]"
              />
              Новинка
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.limited}
                onChange={(e) =>
                  setForm({ ...form, limited: e.target.checked })
                }
                className="size-4 accent-[var(--gold)]"
              />
              Лимит. тираж
            </label>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-border py-3 text-sm font-medium text-foreground transition hover:bg-accent"
          >
            Отмена
          </button>
          <button
            type="submit"
            className="flex-1 rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            {editing ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold"
      />
    </label>
  )
}
