'use client'

import { ImagePlus, RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import { CATEGORY_TREE, DEFAULT_CATEGORY_IMAGES } from '@/lib/data'
import { GROUP_LABELS } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import type { CategoryGroupKey } from '@/lib/types'

const MAX_FILE_SIZE_MB = 4

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Admin control for the Collections (Collezioni) preview cards shown on
 * the homepage — lets the owner swap each category's cinematic background
 * image without touching code. Live product counts are shown alongside so
 * it's obvious at a glance which categories are actually populated. */
export function CollectionsManager() {
  const { products, categoryImages, setCategoryImage, resetCategoryImage, localize, pushToast } =
    useStore()

  return (
    <div>
      <h1 className="mb-2 font-serif text-2xl font-semibold text-foreground">
        Коллекции
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Фоновые изображения карточек «Коллекции» на главной странице.
      </p>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORY_TREE.map(({ group }) => (
          <CategorySlot
            key={group}
            group={group}
            count={products.filter((p) => p.group === group).length}
            label={localize(GROUP_LABELS[group])}
            image={categoryImages[group] || DEFAULT_CATEGORY_IMAGES[group]}
            isCustom={Boolean(categoryImages[group])}
            onChange={(image) => {
              setCategoryImage(group, image)
              pushToast({ title: 'Изображение коллекции обновлено', variant: 'success' })
            }}
            onReset={() => {
              resetCategoryImage(group)
              pushToast({ title: 'Возвращено изображение по умолчанию', variant: 'default' })
            }}
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
}: {
  group: CategoryGroupKey
  label: string
  count: number
  image: string
  isCustom: boolean
  onChange: (image: string) => void
  onReset: () => void
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
      const dataUrl = await readFileAsDataUrl(file)
      onChange(dataUrl)
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
      </div>
    </div>
  )
}
