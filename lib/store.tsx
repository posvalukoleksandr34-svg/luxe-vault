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
import type { Session } from '@supabase/supabase-js'
import { createClient } from './supabase/client'
import { isSupabaseConfigured } from './supabase/env'
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
  currentUser: User | null
  /** True until the initial Supabase session lookup settles, so the UI can
   *  avoid flashing a signed-out state to an already-signed-in visitor. */
  authLoading: boolean

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

  login: (email: string, password: string) => Promise<boolean>
  register: (name: string, email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>

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
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  // ---------------------------------------------------------------- auth ----
  // Single source of truth for "who is signed in". Both a fresh login and a
  // session restored from the cookie on page load land here, so the two can
  // never disagree.
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false)
      return
    }

    const supabase = createClient()

    function applySession(session: Session | null) {
      const u = session?.user
      setCurrentUser(
        u
          ? {
              id: u.id,
              email: u.email ?? '',
              // Set from signUp metadata; the profiles row refines it below.
              name:
                (u.user_metadata?.name as string | undefined)?.trim() ||
                (u.email ?? '').split('@')[0],
            }
          : null,
      )
      setAuthLoading(false)
    }

    supabase.auth.getSession().then(({ data }) => applySession(data.session))

    // NOTE: this callback stays synchronous on purpose. Awaiting another
    // supabase call inside onAuthStateChange can deadlock the client, so the
    // profile lookup is done by the separate effect below instead.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => applySession(session))

    return () => subscription.unsubscribe()
  }, [])

  // Refine the display name from public.profiles, which is the durable record
  // (auth metadata goes stale if the name is ever edited).
  const currentUserId = currentUser?.id ?? null
  useEffect(() => {
    if (!currentUserId || !isSupabaseConfigured) return
    let active = true

    createClient()
      .from('profiles')
      .select('name')
      .eq('id', currentUserId)
      .maybeSingle()
      .then(({ data }) => {
        const name = data?.name?.trim()
        if (!active || !name) return
        setCurrentUser((prev) =>
          prev && prev.id === currentUserId && prev.name !== name ? { ...prev, name } : prev,
        )
      })

    return () => {
      active = false
    }
  }, [currentUserId])


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

  /**
   * Sign in through Supabase Auth. The session is stored in an httpOnly
   * cookie by the SSR client — never in application state or local storage —
   * and the middleware keeps it refreshed on both sides.
   */
  const login = useCallback(
    async (email: string, password: string) => {
      let error
      try {
        error = (
          await createClient().auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
          })
        ).error
      } catch (e) {
        // Missing/invalid Supabase env, or the Auth server is unreachable.
        // Surface it instead of failing silently in the console.
        pushToast({ title: (e as Error).message, variant: 'default' })
        return false
      }
      if (error) {
        pushToast({ title: t('toast.invalidCredentials'), variant: 'default' })
        return false
      }
      // onAuthStateChange (below) is what actually populates currentUser, so
      // both this path and a session restored on page load go through one
      // code path and can never disagree.
      return true
    },
    [pushToast, t],
  )

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      let data, error
      try {
        ;({ data, error } = await createClient().auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          // Read by the handle_new_user() trigger to seed public.profiles.name.
          options: { data: { name: name.trim() } },
        }))
      } catch (e) {
        pushToast({ title: (e as Error).message, variant: 'default' })
        return false
      }

      if (error) {
        pushToast({
          title: /already registered/i.test(error.message)
            ? t('toast.accountExists')
            : error.message,
          variant: 'default',
        })
        return false
      }

      // With "Confirm email" enabled in Supabase, signUp returns a user but no
      // session: the account exists yet cannot act until the link is clicked.
      // Saying "account created" and leaving them signed out would look broken,
      // so this case gets its own message.
      if (data.user && !data.session) {
        pushToast({ title: t('toast.confirmEmail'), variant: 'success' })
        return true
      }

      pushToast({ title: t('toast.accountCreated'), variant: 'success' })
      return true
    },
    [pushToast, t],
  )

  const logout = useCallback(async () => {
    try {
      await createClient().auth.signOut()
    } catch {
      // Already signed out locally, or Supabase unreachable — the auth state
      // listener clears currentUser either way.
    }
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
    currentUser,
    authLoading,
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
