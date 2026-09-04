'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_CATEGORY_IMAGES,
  PAYMENT_METHODS,
  SEED_PRODUCTS,
  SEED_PROMOS,
} from './data'
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  LOCALES,
  UI,
  translate,
  type UIKey,
} from './i18n'
import type {
  CartItem,
  CategoryGroupKey,
  Locale,
  LocalizedText,
  Order,
  Product,
  Promo,
  User,
} from './types'

export type Toast = {
  id: number
  title: string
  description?: string
  variant?: 'default' | 'success' | 'gold'
}

export type PanelState = 'cart' | 'checkout' | 'user' | null

export type SortKey = 'default' | 'price_asc' | 'price_desc'

export type Filter = {
  group: string | null
  category: string | null
  sale: boolean
  sizes: string[]
  sort: SortKey
}

/** Products (incl. admin-uploaded images) are cached here so a page reload
 * never loses catalog changes made from the admin panel. */
export const PRODUCTS_STORAGE_KEY = 'luxe-vault-products'

/** Admin-assigned Collections (Collezioni) preview images, keyed by
 * CategoryGroupKey. A group with no entry here falls back to
 * DEFAULT_CATEGORY_IMAGES — see lib/data.ts. */
export const CATEGORY_IMAGES_STORAGE_KEY = 'luxe-vault-category-images'

type StoreContextValue = {
  products: Product[]
  categoryImages: Partial<Record<CategoryGroupKey, string>>
  setCategoryImage: (group: CategoryGroupKey, image: string) => void
  resetCategoryImage: (group: CategoryGroupKey) => void
  cart: CartItem[]
  promos: Promo[]
  users: User[]
  currentUser: User | null

  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: UIKey) => string
  localize: (text: LocalizedText) => string

  panel: PanelState
  setPanel: (p: PanelState) => void
  activeProduct: Product | null
  openProduct: (p: Product | null) => void
  toasts: Toast[]
  query: string
  setQuery: (q: string) => void
  filter: Filter
  setFilter: (f: Filter) => void

  pushToast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  addToCart: (item: Omit<CartItem, 'key'>) => void
  updateCartQty: (key: string, qty: number) => void
  removeFromCart: (key: string) => void
  clearCart: () => void
  cartCount: number
  cartSubtotal: number
  applyPromo: (code: string) => Promo | null

  login: (email: string, password: string) => boolean
  register: (name: string, email: string, password: string) => boolean
  logout: () => void

  addProduct: (p: Product) => void
  updateProduct: (p: Product) => void
  deleteProduct: (id: string) => void
  addPromo: (p: Promo) => void
  removePromo: (code: string) => void

  paymentMethods: string[]
}

const StoreContext = createContext<StoreContextValue | null>(null)

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}

export function formatPrice(value: number) {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    maximumFractionDigits: 0,
  }).format(value)
}

let toastSeq = 0

export function StoreProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>(SEED_PRODUCTS)
  const [productsHydrated, setProductsHydrated] = useState(false)
  const [categoryImages, setCategoryImages] = useState<Partial<Record<CategoryGroupKey, string>>>({})
  const [categoryImagesHydrated, setCategoryImagesHydrated] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [promos, setPromos] = useState<Promo[]>(SEED_PROMOS)
  const [users, setUsers] = useState<User[]>([
    { name: 'Demo Client', email: 'demo@luxe.vault', password: 'demo123' },
  ])
  const [currentUser, setCurrentUser] = useState<User | null>(null)

  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY) as Locale | null
      if (saved && LOCALES.some((l) => l.code === saved)) {
        setLocaleState(saved)
      }
    } catch {
      // localStorage unavailable
    }
  }, [])

  // Load any previously saved catalog (including admin-uploaded product
  // images) from localStorage once, on mount, so a page refresh never wipes
  // out changes made from the admin panel. An empty array is a legitimate,
  // intentional state (the admin deleted everything) and must be respected —
  // only genuinely missing/corrupted data falls back to the seed catalog.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PRODUCTS_STORAGE_KEY)
      if (saved !== null) {
        const parsed = JSON.parse(saved) as Product[]
        if (Array.isArray(parsed)) {
          setProducts(parsed)
        }
      }
    } catch {
      // localStorage unavailable or corrupted cache — fall back to seed data
    } finally {
      setProductsHydrated(true)
    }
  }, [])

  // Persist the catalog (including any base64 images uploaded through the
  // admin panel) every time it changes, once the initial hydration above
  // has completed.
  useEffect(() => {
    if (!productsHydrated) return
    try {
      window.localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(products))
    } catch {
      // localStorage full or unavailable — changes simply won't persist
    }
  }, [products, productsHydrated])

  // Load any admin-assigned Collections preview images once, on mount, so a
  // reload never reverts a category card back to its default photo.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CATEGORY_IMAGES_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<Record<CategoryGroupKey, string>>
        if (parsed && typeof parsed === 'object') {
          setCategoryImages(parsed)
        }
      }
    } catch {
      // localStorage unavailable or corrupted cache — fall back to defaults
    } finally {
      setCategoryImagesHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!categoryImagesHydrated) return
    try {
      window.localStorage.setItem(CATEGORY_IMAGES_STORAGE_KEY, JSON.stringify(categoryImages))
    } catch {
      // localStorage full or unavailable — changes simply won't persist
    }
  }, [categoryImages, categoryImagesHydrated])

  const setCategoryImage = useCallback((group: CategoryGroupKey, image: string) => {
    setCategoryImages((prev) => ({ ...prev, [group]: image }))
  }, [])

  const resetCategoryImage = useCallback((group: CategoryGroupKey) => {
    setCategoryImages((prev) => {
      const next = { ...prev }
      delete next[group]
      return next
    })
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, l)
    } catch {
      // ignore write errors
    }
  }, [])

  const localize = useCallback(
    (text: LocalizedText) => translate(text, locale),
    [locale],
  )

  const t = useCallback((key: UIKey) => translate(UI[key], locale), [locale])

  const [panel, setPanel] = useState<PanelState>(null)
  const [activeProduct, setActiveProduct] = useState<Product | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>({
    group: null,
    category: null,
    sale: false,
    sizes: [],
    sort: 'default',
  })

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++toastSeq
      setToasts((prev) => [...prev, { ...t, id }])
      setTimeout(() => dismissToast(id), 3200)
    },
    [dismissToast],
  )

  const openProduct = useCallback((p: Product | null) => setActiveProduct(p), [])

  const addToCart = useCallback(
    (item: Omit<CartItem, 'key'>) => {
      const key = `${item.productId}-${item.size}-${item.color}`
      setCart((prev) => {
        const existing = prev.find((c) => c.key === key)
        if (existing) {
          return prev.map((c) =>
            c.key === key ? { ...c, qty: c.qty + item.qty } : c,
          )
        }
        return [...prev, { ...item, key }]
      })
      pushToast({
        title: t('toast.addedToCart'),
        description: `${item.name} · ${item.size} · ${item.color}`,
        variant: 'gold',
      })
    },
    [pushToast, t],
  )

  const updateCartQty = useCallback((key: string, qty: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.key === key ? { ...c, qty: Math.max(1, qty) } : c))
        .filter((c) => c.qty > 0),
    )
  }, [])

  const removeFromCart = useCallback((key: string) => {
    setCart((prev) => prev.filter((c) => c.key !== key))
  }, [])

  const clearCart = useCallback(() => setCart([]), [])

  const cartCount = useMemo(
    () => cart.reduce((sum, c) => sum + c.qty, 0),
    [cart],
  )
  const cartSubtotal = useMemo(
    () => cart.reduce((sum, c) => sum + c.qty * c.price, 0),
    [cart],
  )

  const applyPromo = useCallback(
    (code: string) => {
      const promo = promos.find(
        (p) => p.active && p.code.toUpperCase() === code.trim().toUpperCase(),
      )
      return promo ?? null
    },
    [promos],
  )

  const login = useCallback(
    (email: string, password: string) => {
      const user = users.find(
        (u) => u.email === email.trim().toLowerCase() && u.password === password,
      )
      if (user) {
        setCurrentUser(user)
        pushToast({ title: `${t('toast.welcomeBack')}, ${user.name}`, variant: 'success' })
        return true
      }
      pushToast({ title: t('toast.invalidCredentials'), variant: 'default' })
      return false
    },
    [users, pushToast, t],
  )

  const register = useCallback(
    (name: string, email: string, password: string) => {
      const normalized = email.trim().toLowerCase()
      if (users.some((u) => u.email === normalized)) {
        pushToast({ title: t('toast.accountExists'), variant: 'default' })
        return false
      }
      const user = { name, email: normalized, password }
      setUsers((prev) => [...prev, user])
      setCurrentUser(user)
      pushToast({ title: t('toast.accountCreated'), variant: 'success' })
      return true
    },
    [users, pushToast, t],
  )

  const logout = useCallback(() => {
    setCurrentUser(null)
    pushToast({ title: t('toast.loggedOut'), variant: 'default' })
  }, [pushToast, t])

  const addProduct = useCallback(
    (p: Product) => {
      setProducts((prev) => [p, ...prev])
      pushToast({ title: t('toast.productAdded'), variant: 'success' })
    },
    [pushToast, t],
  )

  const updateProduct = useCallback(
    (p: Product) => {
      setProducts((prev) => prev.map((x) => (x.id === p.id ? p : x)))
      pushToast({ title: t('toast.productUpdated'), variant: 'success' })
    },
    [pushToast, t],
  )

  const deleteProduct = useCallback(
    (id: string) => {
      setProducts((prev) => prev.filter((x) => x.id !== id))
      pushToast({ title: t('toast.productDeleted'), variant: 'default' })
    },
    [pushToast, t],
  )

  const addPromo = useCallback(
    (p: Promo) => {
      setPromos((prev) => {
        if (prev.some((x) => x.code.toUpperCase() === p.code.toUpperCase())) {
          return prev.map((x) =>
            x.code.toUpperCase() === p.code.toUpperCase() ? p : x,
          )
        }
        return [...prev, p]
      })
      pushToast({ title: t('toast.promoSaved'), variant: 'success' })
    },
    [pushToast, t],
  )

  const removePromo = useCallback((code: string) => {
    setPromos((prev) => prev.filter((x) => x.code !== code))
  }, [])

  const value: StoreContextValue = {
    products,
    categoryImages,
    setCategoryImage,
    resetCategoryImage,
    cart,
    promos,
    users,
    currentUser,
    locale,
    setLocale,
    t,
    localize,
    panel,
    setPanel,
    activeProduct,
    openProduct,
    toasts,
    query,
    setQuery,
    filter,
    setFilter,
    pushToast,
    dismissToast,
    addToCart,
    updateCartQty,
    removeFromCart,
    clearCart,
    cartCount,
    cartSubtotal,
    applyPromo,
    login,
    register,
    logout,
    addProduct,
    updateProduct,
    deleteProduct,
    addPromo,
    removePromo,
    paymentMethods: PAYMENT_METHODS,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
