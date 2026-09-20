'use client'

import { ImagePlus, Languages, Loader2, Lock, Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { AVAILABILITY_STATUSES, withDerivedAvailability } from '@/lib/availability'
import { STYLIST_FIT_LABELS, STYLIST_OCCASION_LABELS, STYLIST_STYLE_LABELS } from '@/lib/i18n'
import { FITS, OCCASIONS, STYLES, type Occasion, type StyleKey, type StyleTags } from '@/lib/stylist/types'
import { DEFAULT_DELIVERY_DAYS, isDeliveryDays } from '@/lib/fulfilment'
import { byDepartmentOrder } from '@/lib/departments'
import { useStore } from '@/lib/store'
import type { Color, Locale, LocalizedText, Product, SizeMeasurement, StatusKey } from '@/lib/types'

const STATUS_OPTIONS: { key: StatusKey; label: string }[] = [
  { key: 'in_stock', label: 'В наличии' },
  { key: 'out_of_stock', label: 'Нет в наличии' },
  { key: 'limited_edition', label: 'Лимитированная серия' },
  { key: 'premium_quality', label: 'Премиум качество' },
]

// "В наличии" and "Нет в наличии" describe the same axis of availability
// (AVAILABILITY_STATUSES), so selecting one always clears the other. For a
// product that tracks stock neither is chosen by hand: see derivedStatus.

/** The storefront's languages, in the order an admin fills them in. */
const COPY_LOCALES: Locale[] = ['ru', 'en', 'it', 'fr', 'de']

/** One field per language, '' where a product has none yet. */
function copyFrom(text: Partial<LocalizedText> | undefined): Record<Locale, string> {
  const out: Record<Locale, string> = { ru: '', en: '', it: '', fr: '', de: '' }
  for (const l of COPY_LOCALES) out[l] = typeof text?.[l] === 'string' ? (text[l] as string) : ''
  return out
}

// Mirrors the bucket's own file_size_limit — see lib/server/product-images.ts.
const MAX_FILE_SIZE_MB = 5

/**
 * The delivery fields, as a window, "use the store default", or invalid.
 * Both empty is the default; one filled is read as a single figure for both
 * ends ("about N days").
 */
function parseDeliveryDays(
  minRaw: string,
  maxRaw: string,
): { min: number; max: number } | undefined | 'invalid' {
  const a = minRaw.trim()
  const b = maxRaw.trim()
  if (!a && !b) return undefined
  const range = { min: Number(a || b), max: Number(b || a) }
  return isDeliveryDays(range) ? range : 'invalid'
}
const FALLBACK_IMAGE = '/images/hoodie.png'

/** The choosable style and occasion tags — "no preference" / "just looking"
 *  are answers in the stylist's questionnaire, not properties of a product. */
const STYLE_OPTIONS = STYLES.filter((s) => s !== 'open')
const OCCASION_OPTIONS = OCCASIONS.filter((o) => o !== 'browsing')

/** Only what is set, so an unset field stays "derived from the product"
 *  (lib/stylist/tagging.ts) rather than becoming an empty list. */
function cleanStyleTags(tags: StyleTags): StyleTags | undefined {
  const out: StyleTags = {}
  if (tags.fit) out.fit = tags.fit
  if (tags.style?.length) out.style = tags.style
  if (tags.occasion?.length) out.occasion = tags.occasion
  if (tags.season?.length) out.season = tags.season
  return Object.keys(out).length ? out : undefined
}

/**
 * Uploads images and returns their public URLs.
 *
 * These used to be base64-encoded in the browser and stored inside the product
 * row, which put the bytes of every photograph into every HTML response that
 * mentioned the product — 2.13 MB of markup for three products. They now go to
 * Supabase Storage and the row holds a URL, so the browser and the CDN can
 * cache them and the Next optimiser can resize them.
 */
async function uploadImages(files: File[]): Promise<string[]> {
  const body = new FormData()
  body.append('folder', 'products')
  for (const file of files) body.append('files', file)

  const res = await fetch('/api/admin/uploads', { method: 'POST', body })
  const json = (await res.json().catch(() => null)) as
    | { urls?: string[]; error?: string }
    | null

  if (!res.ok) throw new Error(json?.error || 'Не удалось загрузить изображения')
  return json?.urls ?? []
}

export function ProductForm({
  product,
  onClose,
}: {
  product: Product | null
  onClose: () => void
}) {
  const { addProduct, updateProduct, pushToast, categoryTree, categoryLabels, groupLabels, localize, t } =
    useStore()
  const [saving, setSaving] = useState(false)
  const editing = Boolean(product)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  /**
   * Name and description in every storefront language, edited one tab at a
   * time. The form used to take one name and one description and copy them
   * into all five languages, so an Italian visitor read the Russian text.
   */
  const [names, setNames] = useState<Record<Locale, string>>(() => copyFrom(product?.name))
  const [descriptions, setDescriptions] = useState<Record<Locale, string>>(() =>
    copyFrom(product?.description),
  )
  const [copyLocale, setCopyLocale] = useState<Locale>('ru')
  const [translating, setTranslating] = useState(false)

  const [form, setForm] = useState({
    brand: product?.brand ?? '',
    deliveryMin: product?.deliveryDays?.min?.toString() ?? '',
    deliveryMax: product?.deliveryDays?.max?.toString() ?? '',
    group: product?.group ?? categoryTree[0]?.group ?? '',
    category: product?.category ?? categoryTree[0]?.items[0] ?? '',
    price: product?.price?.toString() ?? '',
    oldPrice: product?.oldPrice?.toString() ?? '',
    sizes: product?.sizes?.join(', ') ?? 'S, M, L, XL',
    images: product?.images?.length ? product.images : product?.image ? [product.image] : [],
    isNew: product?.isNew ?? false,
    limited: product?.limited ?? false,
    statuses:
      product?.statuses && product.statuses.some((s) => AVAILABILITY_STATUSES.includes(s))
        ? product.statuses
        : [...(product?.statuses ?? []), 'in_stock' as StatusKey],
  })

  // Per-size measurements (длина / грудь / плечо / рукав). Stored on the
  // product as `sizeChart` and rendered in the customer-facing size guide.
  // Kept as its own state rather than inside `form` because the rows are
  // edited cell-by-cell and would otherwise churn the whole form object.
  const [measurements, setMeasurements] = useState<SizeMeasurement[]>(
    product?.sizeChart ?? [],
  )

  /**
   * Fit, style and occasion, read by the size finder, smart search and the AI
   * Stylist. The form used to have no field for them and never sent them, so
   * saving a product wiped whatever tags it had; they are kept now, and
   * editable.
   */
  const [styleTags, setStyleTags] = useState<StyleTags>(() => product?.styleTags ?? {})

  function toggleStyle(value: StyleKey) {
    setStyleTags((prev) => {
      const list = prev.style ?? []
      return { ...prev, style: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] }
    })
  }

  function toggleOccasion(value: Occasion) {
    setStyleTags((prev) => {
      const list = prev.occasion ?? []
      return { ...prev, occasion: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] }
    })
  }

  /**
   * Colour variants.
   *
   * Previously there was no colour UI at all — every product silently saved
   * the hardcoded default below, so the storefront's colour picker showed one
   * invented swatch on everything. An existing product keeps whatever it has;
   * only a brand-new one starts from the default.
   */
  const [colors, setColors] = useState<Color[]>(
    product?.colors?.length ? product.colors : [{ name: 'Onyx', hex: '#141414' }],
  )

  function updateColor(index: number, patch: Partial<Color>) {
    setColors((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  /**
   * Stock, keyed "size\u0000colour".
   *
   * Held as a flat map rather than a nested grid because the grid's axes are
   * the sizes and colours fields, which the admin edits while this is on
   * screen. A map keeps the numbers attached to their labels, so renaming a
   * colour drops that column rather than silently shifting counts onto the
   * colour beside it.
   *
   * An empty string is a real value here: it means "not tracked" and is what
   * keeps a product sellable without inventory.
   */
  const [stock, setStock] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (product?.variants ?? []).map((v) => [`${v.size}\u0000${v.color}`, String(v.stock)]),
    ),
  )

  const sizeList = form.sizes
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const colorList = colors.map((c) => c.name.trim()).filter(Boolean)

  const stockAt = (size: string, color: string) => stock[`${size}\u0000${color}`] ?? ''

  function setStockAt(size: string, color: string, value: string) {
    const key = `${size}\u0000${color}`
    setStock((prev) => {
      const next = { ...prev }
      if (value === '') delete next[key]
      else next[key] = String(Math.max(0, Math.trunc(Number(value) || 0)))
      return next
    })
  }

  // Only cells inside the current size × colour grid count — a leftover entry
  // for a deleted colour must not inflate the total the admin is reading.
  const liveCells = sizeList.flatMap((s) =>
    colorList.map((c) => stockAt(s, c)).filter((v) => v !== ''),
  )
  const trackedCells = liveCells.length
  const totalStock = liveCells.reduce((sum, v) => sum + Number(v), 0)

  /**
   * Availability, when the product tracks stock: derived from the grid below,
   * live, as the admin types — any units at all is "В наличии", none is "Нет
   * в наличии". Null for an untracked product (an empty grid), whose toggle
   * stays manual. The server derives it again on save, and the database keeps
   * it in step with every later stock change (migration 0032).
   */
  const derivedStatus: StatusKey | null =
    trackedCells > 0 ? (totalStock > 0 ? 'in_stock' : 'out_of_stock') : null

  function addColor() {
    setColors((prev) => [...prev, { name: '', hex: '#888888' }])
  }

  function updateMeasurement(index: number, field: keyof SizeMeasurement, value: string) {
    setMeasurements((prev) =>
      prev.map((row, i) =>
        i !== index
          ? row
          : field === 'size'
            ? { ...row, size: value }
            : // Empty input becomes 0 rather than NaN, which would be stored
              // as null and render as a blank cell in the size guide.
              { ...row, [field]: Number(value) || 0 },
      ),
    )
  }

  function addMeasurementRow() {
    // Prefill the size from the sizes field so the admin does not retype them.
    const declared = form.sizes
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    const used = new Set(measurements.map((m) => m.size))
    const next = declared.find((s) => !used.has(s)) ?? ''
    setMeasurements((prev) => [
      ...prev,
      { size: next, length: 0, chest: 0, shoulder: 0, sleeve: 0 },
    ])
  }

  const availableCats =
    categoryTree.find((n) => n.group === form.group)?.items ?? []

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploading(true)
    try {
      // Screened here as well as on the server so an obviously wrong file
      // costs a toast rather than a round-trip.
      const accepted: File[] = []
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
        accepted.push(file)
      }

      if (accepted.length > 0) {
        const urls = await uploadImages(accepted)
        setForm((prev) => ({ ...prev, images: [...prev.images, ...urls] }))
        pushToast({
          title: urls.length === 1 ? 'Изображение загружено' : `Загружено изображений: ${urls.length}`,
          variant: 'success',
        })
      }
    } catch (e) {
      pushToast({
        title: e instanceof Error ? e.message : 'Не удалось загрузить изображения',
        variant: 'default',
      })
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
    // Stock decides availability for a tracked product; the buttons are
    // disabled, and this guards the state as well as the markup.
    if (derivedStatus && AVAILABILITY_STATUSES.includes(key)) return
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

  /**
   * Fills the other languages from the tab being edited, through the Gemini
   * translation route. Only fields that are empty, or still a copy of this
   * text, are replaced — a translation the admin wrote is kept.
   */
  async function translateFromCurrent() {
    const source = copyLocale
    const srcName = names[source].trim()
    const srcDesc = descriptions[source].trim()
    if (!srcName && !srcDesc) return
    const replaceable = (value: string, original: string) => !value.trim() || value.trim() === original
    const targets = COPY_LOCALES.filter(
      (l) => l !== source && (replaceable(names[l], srcName) || replaceable(descriptions[l], srcDesc)),
    )
    if (targets.length === 0) {
      pushToast({ title: 'Все языки уже переведены', variant: 'default' })
      return
    }

    setTranslating(true)
    try {
      const res = await fetch('/api/admin/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, targets, name: srcName, description: srcDesc }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Не удалось перевести')

      const translations = (data.translations ?? {}) as Partial<
        Record<Locale, { name: string; description: string }>
      >
      const done = targets.filter((l) => translations[l])
      setNames((prev) => {
        const next = { ...prev }
        for (const l of done) {
          const value = translations[l]?.name
          if (value && replaceable(prev[l], srcName)) next[l] = value
        }
        return next
      })
      setDescriptions((prev) => {
        const next = { ...prev }
        for (const l of done) {
          const value = translations[l]?.description
          if (value && replaceable(prev[l], srcDesc)) next[l] = value
        }
        return next
      })
      pushToast({
        title: done.length
          ? `Переведено: ${done.map((l) => l.toUpperCase()).join(', ')} — проверьте и сохраните`
          : 'Перевод не получен',
        variant: done.length ? 'success' : 'default',
      })
    } catch (e) {
      pushToast({ title: (e as Error).message, variant: 'default' })
    } finally {
      setTranslating(false)
    }
  }

  const deliveryDays = parseDeliveryDays(form.deliveryMin, form.deliveryMax)
  const deliveryInvalid = deliveryDays === 'invalid'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (deliveryInvalid) {
      pushToast({ title: 'Проверьте срок доставки', variant: 'default' })
      return
    }
    const price = Number(form.price) || 0
    const oldPrice = form.oldPrice ? Number(form.oldPrice) : undefined

    // Every language as typed. Empty ones are completed on the server —
    // translated when Gemini is configured, copied from the source otherwise
    // (completeProductCopy in lib/server/translate.ts).
    const localizedName = COPY_LOCALES.reduce(
      (acc, l) => ({ ...acc, [l]: names[l].trim() }),
      {} as LocalizedText,
    )
    const localizedDesc = COPY_LOCALES.reduce(
      (acc, l) => ({ ...acc, [l]: descriptions[l].trim() }),
      {} as LocalizedText,
    )
    if (!COPY_LOCALES.some((l) => localizedName[l])) {
      pushToast({ title: 'Укажите название хотя бы на одном языке', variant: 'default' })
      return
    }

    const images = form.images.length > 0 ? form.images : [FALLBACK_IMAGE]

    // Only cells the admin actually filled in. An empty grid sends an empty
    // array, which clears the product's variants and returns it to
    // untracked — the same state it had before inventory existed.
    const variants = sizeList.flatMap((s) =>
      colorList
        .filter((c) => stockAt(s, c) !== '')
        .map((c) => ({
          size: s,
          color: c,
          stock: Number(stockAt(s, c)),
          lowStockAt:
            product?.variants?.find((v) => v.size === s && v.color === c)?.lowStockAt ?? 5,
        })),
    )

    const next: Product = {
      id: product?.id ?? `p-${Date.now()}`,
      name: localizedName,
      // Free text, and optional: undefined rather than '' so the storefront's
      // "has a brand" check is a single truthiness test everywhere instead of
      // one that has to remember to trim.
      brand: form.brand.trim() || undefined,
      // Undefined = the store default (DEFAULT_DELIVERY_DAYS).
      deliveryDays,
      group: form.group,
      category: form.category,
      price,
      oldPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
      sizes: form.sizes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      // Rows with no name are abandoned edits, not variants, and would render
      // as a nameless swatch the customer cannot identify in their order.
      colors: colors
        .filter((c) => c.name.trim())
        .map((c) => ({
          name: c.name.trim(),
          hex: c.hex,
          image: c.image?.trim() || undefined,
          // Colour-level stock is derived from the variants when the catalogue
          // is read, so it is not written here.
        })),
      variants,
      image: images[0],
      images,
      description: localizedDesc,
      // From the same variants being saved, so the tag and the stock can
      // never disagree; a hand-set tag only for an untracked product.
      statuses: withDerivedAvailability(form.statuses, variants),
      isNew: form.isNew,
      limited: form.limited,
      styleTags: cleanStyleTags(styleTags),
      // Drop rows with no size label — a blank row is an abandoned edit, not
      // a measurement, and would render as an empty size-guide line.
      sizeChart: measurements.filter((m) => m.size.trim()).length
        ? measurements.filter((m) => m.size.trim())
        : undefined,
    }

    // Saving is a network call now. Close only when it actually succeeded —
    // closing regardless would throw away everything the admin just typed on
    // a validation error or a dropped connection, leaving only a toast.
    setSaving(true)
    const ok = editing ? await updateProduct(next) : await addProduct(next)
    setSaving(false)
    if (ok) onClose()
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
          {/* Name and description, per storefront language. A dot on each tab:
              gold — written; grey — still a copy of the Russian text; hollow —
              empty, completed when the product is saved. */}
          <div className="rounded-xl border border-border p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div role="tablist" aria-label="Язык названия и описания" className="flex gap-1">
                {COPY_LOCALES.map((l) => {
                  const filled = Boolean(names[l].trim())
                  const copyOfRu =
                    l !== 'ru' &&
                    filled &&
                    names[l].trim() === names.ru.trim() &&
                    descriptions[l].trim() === descriptions.ru.trim()
                  return (
                    <button
                      key={l}
                      type="button"
                      role="tab"
                      aria-selected={copyLocale === l}
                      onClick={() => setCopyLocale(l)}
                      title={
                        !filled
                          ? 'Не заполнено — будет заполнено при сохранении'
                          : copyOfRu
                            ? 'Копия русского текста — ещё не переведено'
                            : 'Заполнено'
                      }
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider transition ${
                        copyLocale === l
                          ? 'border-gold bg-gold/10 text-gold'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {l}
                      <span
                        aria-hidden
                        className={`size-1.5 rounded-full ${
                          !filled
                            ? 'border border-muted-foreground/50'
                            : copyOfRu
                              ? 'bg-muted-foreground/60'
                              : 'bg-gold'
                        }`}
                      />
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={() => void translateFromCurrent()}
                disabled={
                  translating || (!names[copyLocale].trim() && !descriptions[copyLocale].trim())
                }
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {translating ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Languages className="size-3" />
                )}
                Перевести с {copyLocale.toUpperCase()}
              </button>
            </div>

            <div className="space-y-3">
              <Input
                label={`Название (${copyLocale.toUpperCase()})`}
                value={names[copyLocale]}
                onChange={(v) => setNames((prev) => ({ ...prev, [copyLocale]: v }))}
              />
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
                  Описание ({copyLocale.toUpperCase()})
                </span>
                <textarea
                  value={descriptions[copyLocale]}
                  onChange={(e) => {
                    const value = e.target.value
                    setDescriptions((prev) => ({ ...prev, [copyLocale]: value }))
                  }}
                  rows={4}
                  className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold"
                />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground/60">
              Достаточно одного языка. Пустые языки при сохранении переводятся автоматически
              (без GEMINI_API_KEY — копируют исходный текст). «Перевести» заменяет только пустые
              поля и копии исходного текста — ваши переводы не трогает.
            </p>
          </div>

          {/* Optional on purpose. The product page used to print a hardcoded
              "Бренд: Luxe Vault" on every item; leaving this empty now prints
              no brand line at all, which is the honest state for a product
              nobody has assigned one to. */}
          <Input
            label="Бренд"
            value={form.brand}
            onChange={(v) => setForm({ ...form, brand: v })}
            placeholder="Не обязательно — пусто, если бренд не указан"
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
                {t('admin.department')}
              </span>
              <select
                value={form.group}
                onChange={(e) => {
                  const group = e.target.value as typeof form.group
                  const cats =
                    categoryTree.find((n) => n.group === group)?.items ?? []
                  setForm({ ...form, group, category: cats[0] })
                }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-gold"
              >
                {/* Core departments first (lib/departments.ts), so a new
                    product always opens on a real one even while older
                    collections are still being emptied. */}
                {[...categoryTree]
                  .sort((a, b) => byDepartmentOrder(a.group, b.group))
                  .map((n) => (
                    <option key={n.group} value={n.group}>
                      {localize(groupLabels[n.group] ?? {}) || n.group}
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
                    {localize(categoryLabels[c] ?? {}) || c}
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

          {/* This product's own delivery estimate — shown on its page, in the
              visitor's language, and stamped on its orders. Empty keeps the
              store default. */}
          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
              Срок доставки, дней
            </span>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                min={1}
                max={120}
                step={1}
                value={form.deliveryMin}
                onChange={(e) => setForm({ ...form, deliveryMin: e.target.value })}
                placeholder={`от · ${DEFAULT_DELIVERY_DAYS.min}`}
                aria-label="Срок доставки: от, дней"
                className={`w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-gold ${deliveryInvalid ? 'border-destructive' : 'border-border'}`}
              />
              <input
                type="number"
                min={1}
                max={120}
                step={1}
                value={form.deliveryMax}
                onChange={(e) => setForm({ ...form, deliveryMax: e.target.value })}
                placeholder={`до · ${DEFAULT_DELIVERY_DAYS.max}`}
                aria-label="Срок доставки: до, дней"
                className={`w-full rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-gold ${deliveryInvalid ? 'border-destructive' : 'border-border'}`}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground/60">
              От подтверждения оплаты до доставки. Пусто — срок магазина по умолчанию (
              {DEFAULT_DELIVERY_DAYS.min}–{DEFAULT_DELIVERY_DAYS.max} дн.). Целые недели
              показываются неделями: 14 и 14 — «около 2 недель», 10 и 14 — «10–14 дней».
            </p>
            {deliveryInvalid && (
              <p className="mt-1 text-[11px] text-destructive">
                Целые дни от 1 до 120; «до» не меньше «от».
              </p>
            )}
          </div>

          {/* Colour variants. Each row is one swatch the customer sees on the
              product page: a name they can recognise in their order, a hex for
              the swatch itself, an optional photo of the product in that
              colour, and an optional stock count. */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-wider text-foreground">
                Цвета
              </span>
              <button
                type="button"
                onClick={addColor}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-gold/50 hover:text-gold"
              >
                <Plus className="size-3" />
                Цвет
              </button>
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground/60">
              Название обязательно — по нему покупатель узнаёт цвет в заказе. Остаток
              можно оставить пустым: пусто — не отслеживается, 0 — распродано.
            </p>

            {colors.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground/70">
                Цвета не заданы
              </p>
            ) : (
              <div className="space-y-2">
                {colors.map((c, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2"
                  >
                    {/* Native colour input: it gives the OS picker for free and
                        stays keyboard-accessible, which a custom swatch grid
                        would have to reimplement. */}
                    <input
                      type="color"
                      value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#888888'}
                      onChange={(e) => updateColor(i, { hex: e.target.value })}
                      className="size-9 shrink-0 cursor-pointer rounded border border-border bg-background"
                      aria-label="Выбрать цвет"
                    />

                    <input
                      type="text"
                      value={c.name}
                      onChange={(e) => updateColor(i, { name: e.target.value })}
                      placeholder="Название, напр. Onyx"
                      className="w-36 flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-gold"
                    />

                    {/* Typed alongside the picker so an admin can paste a hex
                        from a brand palette instead of eyeballing it. */}
                    <input
                      type="text"
                      value={c.hex}
                      onChange={(e) => updateColor(i, { hex: e.target.value })}
                      placeholder="#141414"
                      spellCheck={false}
                      className="w-24 rounded border border-border bg-background px-2 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-gold"
                    />

                    <input
                      type="url"
                      value={c.image ?? ''}
                      onChange={(e) => updateColor(i, { image: e.target.value })}
                      placeholder="URL фото этого цвета (необязательно)"
                      className="w-full min-w-[10rem] flex-1 rounded border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-gold sm:w-auto"
                    />


                    {/* Preview of the variant photo, so a wrong URL is obvious
                        before saving rather than after a customer sees it. */}
                    {c.image?.trim() ? (
                      <span className="size-9 shrink-0 overflow-hidden rounded border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.image} alt="" className="size-full object-cover" />
                      </span>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setColors((prev) => prev.filter((_, x) => x !== i))}
                      className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-destructive"
                      aria-label="Удалить цвет"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Per-size measurements. These feed the size-guide table the
              customer opens from the product page, so the column order here
              matches the order rendered there. */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-wider text-foreground">
                Замеры по размерам
              </span>
              <button
                type="button"
                onClick={addMeasurementRow}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-gold/50 hover:text-gold"
              >
                <Plus className="size-3" />
                Строка
              </button>
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground/60">
              Все значения в сантиметрах. Пустая таблица — гид по размерам не показывается.
            </p>

            {measurements.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground/70">
                Замеры не заданы
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 font-normal">Размер</th>
                      <th className="px-3 py-2 font-normal">Длина</th>
                      <th className="px-3 py-2 font-normal">Грудь</th>
                      <th className="px-3 py-2 font-normal">Плечо</th>
                      <th className="px-3 py-2 font-normal">Рукав</th>
                      <th className="w-10 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {measurements.map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            value={row.size}
                            onChange={(e) => updateMeasurement(i, 'size', e.target.value)}
                            placeholder="M"
                            className="w-20 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-gold"
                          />
                        </td>
                        {(['length', 'chest', 'shoulder', 'sleeve'] as const).map((field) => (
                          <td key={field} className="px-2 py-1.5">
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={row[field] || ''}
                              onChange={(e) => updateMeasurement(i, field, e.target.value)}
                              placeholder="0"
                              className="w-20 rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-gold"
                            />
                          </td>
                        ))}
                        <td className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setMeasurements((prev) => prev.filter((_, x) => x !== i))
                            }
                            className="flex size-7 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-destructive"
                            aria-label="Удалить строку"
                          >
                            <X className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
              Статусы <span className="text-destructive">*</span>
            </span>
            <p className="mb-1.5 text-[11px] text-muted-foreground/60">
              {derivedStatus
                ? `Наличие считается автоматически по остаткам ниже: всего ${totalStock} шт. Чтобы задать его вручную, очистите таблицу остатков.`
                : '«В наличии» / «Нет в наличии» обязателен и взаимоисключающий. Заполните остатки ниже — и наличие будет считаться автоматически.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => {
                // Availability of a tracked product: shown, not chosen.
                const auto = derivedStatus !== null && AVAILABILITY_STATUSES.includes(opt.key)
                const selected = auto ? derivedStatus === opt.key : form.statuses.includes(opt.key)
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => toggleStatus(opt.key)}
                    disabled={auto}
                    aria-pressed={selected}
                    title={auto ? 'Рассчитывается из остатков' : undefined}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed ${
                      selected
                        ? 'border-gold bg-gold/10 text-gold'
                        : 'border-border text-muted-foreground hover:border-foreground/40'
                    } ${auto && !selected ? 'opacity-40 hover:border-border' : ''}`}
                  >
                    {auto && selected && <Lock className="size-3" aria-hidden />}
                    {opt.label}
                    {auto && selected && (
                      <span className="rounded bg-gold/15 px-1 py-px text-[9px] uppercase tracking-wider">авто</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Fit, style and occasion. Left unset, each is worked out from the
              product's name and category (lib/stylist/tagging.ts); set here,
              the admin's word wins. */}
          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
              Посадка, стиль и повод
            </span>
            <p className="mb-2 text-[11px] text-muted-foreground/60">
              Используются подбором размера, умным поиском и AI-стилистом. Не выбрано — определяется
              автоматически по названию и категории.
            </p>
            <div className="space-y-2.5">
              <fieldset>
                <legend className="mb-1 block text-[11px] text-muted-foreground">Посадка</legend>
                <div className="flex flex-wrap gap-1.5">
                  {[null, ...FITS].map((f) => {
                    const selected = (styleTags.fit ?? null) === f
                    return (
                      <button
                        key={f ?? 'auto'}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setStyleTags((prev) => ({ ...prev, fit: f ?? undefined }))}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
                          selected
                            ? 'border-gold bg-gold/10 text-gold'
                            : 'border-border text-muted-foreground hover:border-foreground/40'
                        }`}
                      >
                        {f ? STYLIST_FIT_LABELS[f].ru : 'Авто'}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-1 block text-[11px] text-muted-foreground">Стиль</legend>
                <div className="flex flex-wrap gap-1.5">
                  {STYLE_OPTIONS.map((s) => {
                    const selected = (styleTags.style ?? []).includes(s)
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleStyle(s)}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
                          selected
                            ? 'border-gold bg-gold/10 text-gold'
                            : 'border-border text-muted-foreground hover:border-foreground/40'
                        }`}
                      >
                        {STYLIST_STYLE_LABELS[s].ru}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-1 block text-[11px] text-muted-foreground">Повод</legend>
                <div className="flex flex-wrap gap-1.5">
                  {OCCASION_OPTIONS.map((o) => {
                    const selected = (styleTags.occasion ?? []).includes(o)
                    return (
                      <button
                        key={o}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleOccasion(o)}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
                          selected
                            ? 'border-gold bg-gold/10 text-gold'
                            : 'border-border text-muted-foreground hover:border-foreground/40'
                        }`}
                      >
                        {STYLIST_OCCASION_LABELS[o].ru}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            </div>
          </div>

          {/* Stock, per size and colour — the combination a customer actually
              buys. Leaving the whole grid blank keeps the product untracked,
              which is how every product behaved before inventory existed. */}
          <div>
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground">
              Остатки
            </span>
            <p className="mb-2 text-[11px] text-muted-foreground/60">
              Количество на складе для каждого размера и цвета. Оставьте всё пустым — товар
              продаётся без учёта остатков. 0 — «нет в наличии».
            </p>

            {sizeList.length === 0 || colorList.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground/60">
                Укажите размеры и цвета выше, чтобы заполнить остатки.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[22rem] text-left text-[12px]">
                    <thead className="bg-background/60 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-normal">Цвет</th>
                        {sizeList.map((s) => (
                          <th key={s} className="px-2 py-2 text-center font-normal">
                            {s}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {colorList.map((c) => (
                        <tr key={c} className="border-t border-border/60">
                          <td className="whitespace-nowrap px-3 py-2 text-foreground">{c}</td>
                          {sizeList.map((s) => (
                            <td key={s} className="px-2 py-1.5 text-center">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={stockAt(s, c)}
                                onChange={(e) => setStockAt(s, c, e.target.value)}
                                aria-label={`${c} ${s}`}
                                placeholder="—"
                                className="w-16 rounded border border-border bg-background px-2 py-1.5 text-center text-[12px] tabular-nums text-foreground outline-none focus:border-gold"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground/60" aria-live="polite">
                  Всего: <span className="tabular-nums text-foreground">{totalStock}</span> шт.
                  {trackedCells === 0 && ' — учёт остатков выключен, наличие задаётся вручную'}
                  {derivedStatus && (
                    <>
                      {' '}· статус товара:{' '}
                      <span className={derivedStatus === 'in_stock' ? 'text-emerald-400' : 'text-destructive'}>
                        {derivedStatus === 'in_stock' ? 'В наличии' : 'Нет в наличии'}
                      </span>{' '}
                      (авто)
                    </>
                  )}
                </p>
              </>
            )}
          </div>

          {/* Images upload to Supabase Storage; the row holds a URL. See
              lib/server/product-images.ts for why they are not base64. */}
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
            disabled={saving || deliveryInvalid}
            className="flex-1 rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Сохранение…' : editing ? 'Сохранить' : 'Добавить'}
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
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  placeholder?: string
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
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-gold"
      />
    </label>
  )
}
