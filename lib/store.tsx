'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { trackAddToCart, trackLogin, trackRemoveFromCart, trackSignUp } from './analytics'
import { CART_STORAGE_KEY, readCart, reconcileCart, writeCart } from './cart-storage'
import { authCallbackUrl } from './site-url'
import { readWishlist, subscribeToWishlist, toggleWishlistItem } from '@/lib/wishlist'
import {
  BASE_CURRENCY,
  CURRENCY_STORAGE_KEY,
  formatMoney,
  getActiveCurrency,
  getRates,
  isCurrencyCode,
  isExchangeRates,
  setActiveCurrency,
  setRates,
  type ExchangeRates,
  type CurrencyCode,
} from './currency'
import { createClient } from './supabase/client'
import { readReferralCookie } from './referral-program'
import { isSupabaseConfigured } from './supabase/env'
import { CATEGORY_TREE, DEFAULT_CATEGORY_IMAGES, PAYMENT_METHODS, SEED_PROMOS } from './data'
import {
  DEFAULT_SHIPPING_SETTINGS,
  validateShippingSettings,
  type ShippingSettings,
} from '@/config/shipping'
import {
  CATEGORY_LABELS,
  GROUP_LABELS,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  LOCALES,
  UI,
  translate,
  type UIKey,
} from './i18n'
import type {
  CartItem,
  CategoryKey,
  Category,
  Collection,
  CategoryGroupKey,
  Locale,
  LocalizedText,
  Order,
  Product,
  Promo,
  SupportCategory,
  User,
} from './types'

export type Toast = {
  id: number
  title: string
  description?: string
  variant?: 'default' | 'success' | 'gold'
}

export type PanelState = 'cart' | 'checkout' | 'user' | 'support' | null

/** Where the support center drawer opens: its help screen, the request form
 *  (optionally on a topic or an order), the list of requests, or one of them. */
export type SupportEntry = {
  view: 'home' | 'new' | 'tickets' | 'ticket'
  number?: string
  token?: string
  category?: SupportCategory
  orderNumber?: string
}

/** What an add-to-cart did. `added` is less than asked for — or 0 — when the
 *  variant's stock is the limit. */
export type AddToCartResult = { added: number; limit: number | null; inCart: number }

/** Which section the account drawer shows. Lifted out of the drawer so a
 *  caller can open it on a specific tab rather than on whatever was open
 *  last. */
export type AccountTab = 'orders' | 'profile' | 'looks'

export type SortKey =
  | 'default'
  | 'newest'
  | 'price_asc'
  | 'price_desc'
  | 'discount'

export type Filter = {
  group: string | null
  category: string | null
  sale: boolean
  sizes: string[]
  sort: SortKey

  /** Colour names, matched against Product.colors[].name. */
  colors: string[]
  /** Inclusive bounds in CHF. null means unbounded on that side, which is not
   *  the same as 0 — a minimum of 0 would still exclude nothing, but writing
   *  it as null keeps "no filter" distinguishable from "free or more". */
  minPrice: number | null
  maxPrice: number | null
  /** Hide anything a customer cannot actually buy right now. */
  inStockOnly: boolean
}

/** The empty filter. One definition so "clear all" and the initial state can
 *  never drift apart — they did, and a cleared filter kept its sizes. */
export const EMPTY_FILTER: Filter = {
  group: null,
  category: null,
  sale: false,
  sizes: [],
  sort: 'default',
  colors: [],
  minPrice: null,
  maxPrice: null,
  inStockOnly: false,
}

/** Admin-assigned Collections (Collezioni) preview images, keyed by
 * CategoryGroupKey. A group with no entry here falls back to
 * DEFAULT_CATEGORY_IMAGES — see lib/data.ts. */
export const CATEGORY_IMAGES_STORAGE_KEY = 'luxe-vault-category-images'

type StoreContextValue = {
  products: Product[]
  collections: Collection[]
  categories: Category[]
  categoryTree: { group: CategoryGroupKey; items: CategoryKey[] }[]
  groupLabels: Record<string, LocalizedText>
  categoryLabels: Record<string, LocalizedText>
  catalogLoading: boolean
  reloadCatalog: () => Promise<void>
  /** The admin's shipping fee, free-shipping threshold and delivery window
   *  (store_settings) — seeded by the layout, refreshed with the catalogue. */
  shipping: ShippingSettings
  categoryImages: Partial<Record<CategoryGroupKey, string>>
  setCategoryImage: (group: CategoryGroupKey, image: string) => Promise<void>
  resetCategoryImage: (group: CategoryGroupKey) => Promise<void>
  cart: CartItem[]
  promos: Promo[]
  currentUser: User | null
  /** True until the initial Supabase session lookup settles, so the UI can
   *  avoid flashing a signed-out state to an already-signed-in visitor. */
  authLoading: boolean

  locale: Locale
  setLocale: (l: Locale) => void
  /** The chosen currency. Prices are stored in CHF; this changes how
   *  formatPrice() shows them and what a card is charged in. See
   *  lib/currency.ts. */
  currency: CurrencyCode
  setCurrency: (c: CurrencyCode) => void
  /** Units of each currency per 1 CHF currently in force (live, or the
   *  fallback table until /api/rates answers). */
  exchangeRates: ExchangeRates
  t: (key: UIKey) => string
  /** Localized string with {placeholder} substitution, e.g.
   *  tf('otp.step2.resendIn', { n: 42 }). Values are inserted verbatim, so
   *  never pass anything that will be rendered as HTML. */
  tf: (key: UIKey, vars: Record<string, string | number>) => string
  localize: (text: LocalizedText) => string

  panel: PanelState
  setPanel: (p: PanelState) => void
  accountTab: AccountTab
  setAccountTab: (t: AccountTab) => void
  /** Opens the account drawer on a given section in one call, so a caller
   *  cannot set the tab and forget to open the panel. */
  openAccount: (tab?: AccountTab) => void
  /** Which form the account drawer shows a signed-out visitor. */
  authMode: 'login' | 'register'
  /** Opens the account drawer on sign-in or on registration — for a prompt
   *  that has already told the visitor which of the two they are about to do. */
  openAuth: (mode?: 'login' | 'register') => void
  toasts: Toast[]
  query: string
  setQuery: (q: string) => void
  filter: Filter
  setFilter: (f: Filter) => void

  pushToast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  /** Adds up to what the variant's stock allows, counting what the cart
   *  already holds; says how many went in. */
  addToCart: (item: Omit<CartItem, 'key'>) => AddToCartResult
  /** Sets a line's quantity, never above its variant's stock. */
  updateCartQty: (key: string, qty: number) => void
  /** How many units of this exact size + colour exist to sell: null when the
   *  product's stock is not tracked. The server's latest answer when there is
   *  one, else the catalogue. */
  stockLimit: (productId: string, size: string, color: string) => number | null

  supportEntry: SupportEntry
  /** Opens the support center drawer. */
  openSupport: (entry?: SupportEntry) => void
  /** Replies from the support team the customer has not read yet. */
  supportUnread: number
  setSupportUnread: (n: number) => void
  removeFromCart: (key: string) => void
  clearCart: () => void
  /** Saved product ids, newest first (lib/wishlist.ts). */
  wishlist: string[]
  wishlistCount: number
  isWishlisted: (productId: string) => boolean
  toggleWishlist: (productId: string) => void
  cartCount: number
  cartSubtotal: number
  applyPromo: (code: string) => Promise<Promo | null>

  login: (email: string, password: string) => Promise<boolean>
  register: (
    name: string,
    email: string,
    password: string,
  ) => Promise<{
    ok: boolean
    needsConfirmation: boolean
    alreadyRegistered: boolean
    /** Present only for errors that are not "already registered". */
    message?: string
  }>
  resendConfirmation: (email: string) => Promise<{ ok: boolean; message?: string }>
  verifySignupCode: (
    email: string,
    token: string,
  ) => Promise<{ ok: boolean; message?: string }>
  signInWithGoogle: () => Promise<{ ok: boolean; message?: string }>
  requestRecoveryCode: (email: string) => Promise<{ ok: boolean; message?: string }>
  verifyRecoveryCode: (
    email: string,
    token: string,
  ) => Promise<{ ok: boolean; message?: string }>
  updatePassword: (password: string) => Promise<{ ok: boolean; message?: string }>
  logout: () => Promise<void>

  addProduct: (p: Product) => Promise<boolean>
  updateProduct: (p: Product) => Promise<boolean>
  deleteProduct: (id: string) => Promise<boolean>
  addPromo: (p: Promo) => void
  removePromo: (code: string) => void

  paymentMethods: string[]
}

/**
 * useLayoutEffect warns during SSR because it cannot run there. The saved cart
 * must be restored BEFORE the browser paints, though, or the header badge
 * would render "0" for one frame and then jump — so the layout variant is used
 * in the browser and the passive one on the server, where it is inert anyway.
 */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

const StoreContext = createContext<StoreContextValue | null>(null)

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}

/**
 * A CHF amount, shown in the visitor's chosen display currency.
 *
 * For what is being SHOPPED: the catalogue, the cart, the checkout summary.
 * In CHF it prints exactly what it always did ("CHF 1’000").
 */
export function formatPrice(value: number, exact = false) {
  // `exact` keeps the cents, for fees ("CHF 14.90", not "CHF 15").
  return formatMoney(value, getActiveCurrency(), exact)
}

/**
 * A CHF amount, always shown in CHF.
 *
 * For RECORDS of what was charged — order history, the order page, the
 * payment confirmation, the admin console. A past order paid in francs must
 * never be re-labelled in euros because the visitor later changed a display
 * setting.
 */
export function formatChf(value: number, exact = false) {
  return formatMoney(value, BASE_CURRENCY, exact)
}

let toastSeq = 0

/** A variant's stock per the catalogue. null when the product is untracked
 *  (no variant rows — see Product.variants), 0 for a combination with no row
 *  or a product the admin marked out of stock. */
function catalogLimit(product: Product, size: string, color: string): number | null {
  if (product.statuses.includes('out_of_stock')) return 0
  if (!product.variants || product.variants.length === 0) return null
  return product.variants.find((v) => v.size === size && v.color === color)?.stock ?? 0
}

type StockNote = { name: string; size: string; n: number }

/** The lines clamped to their limits, and what changed — for the notice. */
function clampToStock(
  lines: CartItem[],
  limitOf: (line: CartItem) => number | null,
): { next: CartItem[]; notes: StockNote[] } {
  const notes: StockNote[] = []
  const next: CartItem[] = []
  for (const line of lines) {
    const limit = limitOf(line)
    if (limit === null || line.qty <= limit) {
      next.push(line)
      continue
    }
    notes.push({ name: line.name, size: line.size, n: limit })
    if (limit > 0) next.push({ ...line, qty: limit })
  }
  return { next: notes.length ? next : lines, notes }
}

export function StoreProvider({
  children,
  initialCatalog,
  initialShipping,
}: {
  children: ReactNode
  /**
   * Catalogue read on the server and handed in as the initial state.
   *
   * Without it the grid was empty in the server HTML and only appeared when
   * /api/catalog resolved on the client — the single measured source of layout
   * shift on the storefront (CLS 0.0376, the #shop section reflowing ~3.5s in).
   * Seeding here means the first painted frame already has the products.
   *
   * loadCatalog() still runs on mount so an admin edit made after this page
   * was rendered still lands; it just no longer decides whether anything is
   * visible at all.
   */
  initialCatalog?: { products: Product[]; collections: Collection[]; categories: Category[] }
  /**
   * Shipping settings read on the server (getShippingSettings), so the first
   * painted cart, product page and footer already show the admin's figures.
   */
  initialShipping?: ShippingSettings
}) {
  const [products, setProducts] = useState<Product[]>(initialCatalog?.products ?? [])
  // Already hydrated when the server supplied the catalogue — otherwise the
  // grid would render its "loading" branch over content it already has.
  const [productsHydrated, setProductsHydrated] = useState(Boolean(initialCatalog))
  const [collections, setCollections] = useState<Collection[]>(initialCatalog?.collections ?? [])
  const [categories, setCategories] = useState<Category[]>(initialCatalog?.categories ?? [])
  const [shipping, setShipping] = useState<ShippingSettings>(
    initialShipping ?? DEFAULT_SHIPPING_SETTINGS,
  )
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [cart, setCart] = useState<CartItem[]>([])
  const [promos, setPromos] = useState<Promo[]>(SEED_PROMOS)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [metadataLanguage, setMetadataLanguage] = useState<string | null>(null)

  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

/**
 * Asks the server to send the welcome email.
 *
 * There is no reliable client-side "this is the first ever sign-in" signal, so
 * the once-only guarantee lives in the database: /api/auth/welcome claims a
 * stamp atomically and answers { sent: false } every time after the first.
 *
 * The sessionStorage guard is not that guarantee — it just stops a pointless
 * request on every page load in the same tab. Failure is ignored entirely; a
 * missing welcome email must never interfere with signing in.
 */
function maybeSendWelcome() {
  try {
    if (sessionStorage.getItem('lv.welcome-checked')) return
    sessionStorage.setItem('lv.welcome-checked', '1')
  } catch {
    // Storage blocked. Fall through — the server still de-duplicates.
  }
  void fetch('/api/auth/welcome', { method: 'POST' }).catch(() => {})
}

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
      // What Supabase currently has on the row — compared against the active
      // locale by the sync effect below.
      setMetadataLanguage((u?.user_metadata?.language as string | undefined) ?? null)
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

    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session)
      if (data.session) maybeSendWelcome()
    })

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

  /**
   * Keeps auth metadata's `language` in step with the active locale.
   *
   * setLocale() alone is not enough: it can only write while a session exists,
   * so a visitor who picks Italian and *then* signs in would never have it
   * stored, and their recovery email would arrive in English. This runs on
   * sign-in too, which also backfills accounts created before `language` was
   * recorded at signup.
   *
   * Supabase merges `data` into raw_user_meta_data rather than replacing it,
   * so writing `language` here cannot clobber `name` (verified against the
   * live project).
   */
  useEffect(() => {
    if (!currentUserId || !isSupabaseConfigured) return
    if (metadataLanguage === locale) return

    let active = true
    createClient()
      .auth.updateUser({ data: { language: locale } })
      .then(({ error }) => {
        // Mirror locally on success so this does not re-fire every render.
        if (active && !error) setMetadataLanguage(locale)
      })
      .catch(() => {
        // Cosmetic sync — never surfaced, never blocking.
      })

    return () => {
      active = false
    }
  }, [currentUserId, locale, metadataLanguage])

  /**
   * An invited friend who signs in: recorded as the referrer's pending invite.
   * Only when the browser holds a referral code (the /r/<code> cookie), and
   * once per account per browser session. The server decides eligibility —
   * a new account with no orders — and reads the code from the cookie itself.
   */
  useEffect(() => {
    if (!currentUserId || !readReferralCookie()) return
    const key = `lv-ref-claimed:${currentUserId}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      // Storage blocked: the claim is idempotent, so trying again is harmless.
    }
    fetch('/api/referrals/claim', { method: 'POST' }).catch(() => {
      // Best effort; the code still applies at checkout.
    })
  }, [currentUserId])

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

  /**
   * The display currency — restored after mount, exactly like the language,
   * so the server HTML (always CHF) and the first client render agree and
   * nothing mismatches on hydration.
   */
  const [currency, setCurrencyState] = useState<CurrencyCode>(BASE_CURRENCY)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CURRENCY_STORAGE_KEY)
      if (isCurrencyCode(saved) && saved !== BASE_CURRENCY) {
        setActiveCurrency(saved)
        setCurrencyState(saved)
      }
    } catch {
      // localStorage unavailable — stay in CHF.
    }
  }, [])

  /**
   * Live exchange rates — the same snapshot the server charges cards at
   * (app/api/rates). Fetched once per visit after hydration; until then, and if
   * it fails, prices use the fallback table, exactly as the server rendered
   * them. Installed in the module first so every formatPrice() in the
   * re-render this state change triggers already reads them.
   */
  const [exchangeRates, setExchangeRates] = useState<ExchangeRates>(getRates)

  useEffect(() => {
    let cancelled = false
    fetch('/api/rates')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { rates?: unknown } | null) => {
        const rates = data?.rates
        if (cancelled || !isExchangeRates(rates)) return
        setRates(rates)
        setExchangeRates(rates)
      })
      .catch(() => {
        // Offline or blocked: the fallback rates stay in force.
      })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Saved products. Hydrated after mount (the server has no localStorage, and
   * reading it during render would mismatch the first paint) and kept in step
   * with every other tab.
   */
  const [wishlist, setWishlist] = useState<string[]>([])

  useEffect(() => {
    setWishlist(readWishlist())
    return subscribeToWishlist(setWishlist)
  }, [])

  const toggleWishlist = useCallback((productId: string) => {
    if (!productId) return
    // The module writes and broadcasts; the subscription above is what puts
    // the new list into state, so every open tab agrees.
    setWishlist(toggleWishlistItem(productId))
  }, [])

  const isWishlisted = useCallback((productId: string) => wishlist.indexOf(productId) !== -1, [wishlist])

  const setCurrency = useCallback((next: CurrencyCode) => {
    // The module value first, so every formatPrice() in the re-render this
    // state change triggers already reads the new currency.
    setActiveCurrency(next)
    setCurrencyState(next)
    try {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, next)
    } catch {
      // Not persisting is acceptable; the choice holds for this visit.
    }
  }, [])

  // The catalogue is server state now, not browser state.
  //
  // It used to live in this browser's localStorage, which meant an admin's
  // edits were saved to the admin's own machine and no customer could ever
  // see them. Fetching it from /api/catalog is what actually makes an admin
  // change reach the shop.
  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch('/api/catalog', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      if (Array.isArray(data.products)) setProducts(data.products)
      if (Array.isArray(data.collections)) setCollections(data.collections)
      if (Array.isArray(data.categories)) setCategories(data.categories)
      // Re-validated rather than trusted: a malformed payload keeps the last
      // good figures instead of pricing the cart from NaN.
      const nextShipping = validateShippingSettings(data.shipping)
      if (nextShipping.ok) setShipping(nextShipping.settings)
    } catch {
      // Catalogue unreachable (offline, or migrations not run yet). Leave the
      // last known list in place rather than blanking the shop.
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  // Preview images now live on the collection row; this keeps the old
  // `categoryImages[group]` shape so consuming components did not change.
  // Derived from the database, with the original hardcoded maps as a fallback
  // for the seeded slugs. This is what lets a collection created in the admin
  // panel show up in the storefront filters without a redeploy.
  const categoryTree = useMemo(
    () =>
      collections.length === 0
        ? CATEGORY_TREE
        : collections.map((c) => ({
            group: c.slug,
            items: categories
              .filter((cat) => cat.collectionSlug === c.slug)
              .map((cat) => cat.slug),
          })),
    [collections, categories],
  )

  const groupLabels = useMemo(() => {
    const map: Record<string, LocalizedText> = { ...GROUP_LABELS }
    for (const c of collections) map[c.slug] = c.name
    return map
  }, [collections])

  const categoryLabels = useMemo(() => {
    const map: Record<string, LocalizedText> = { ...CATEGORY_LABELS }
    for (const c of categories) map[c.slug] = c.name
    return map
  }, [categories])

  const categoryImages = useMemo(() => {
    const map: Partial<Record<CategoryGroupKey, string>> = {}
    for (const c of collections) if (c.image) map[c.slug] = c.image
    return map
  }, [collections])

  const setLocale = useCallback(
    (l: Locale) => {
      setLocaleState(l)
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, l)
      } catch {
        // ignore write errors
      }

      // Mirror the choice into auth metadata so transactional emails follow
      // the customer's current language rather than the one they happened to
      // sign up in. Only possible while signed in — updateUser needs a
      // session — which is precisely why the value has to be stored ahead of
      // time rather than passed at password-reset time.
      if (!currentUserId || !isSupabaseConfigured) return
      void createClient()
        .auth.updateUser({ data: { language: l } })
        .catch(() => {
          // Cosmetic sync; a failure here must never block a language switch.
        })
    },
    [currentUserId],
  )

  const tf = useCallback(
    (key: UIKey, vars: Record<string, string | number>) =>
      Object.entries(vars).reduce(
        (out, [name, value]) => out.split(`{${name}}`).join(String(value)),
        translate(UI[key], locale),
      ),
    [locale],
  )

  const localize = useCallback(
    (text: LocalizedText) => translate(text, locale),
    [locale],
  )

  const t = useCallback((key: UIKey) => translate(UI[key], locale), [locale])

  const [panel, setPanel] = useState<PanelState>(null)
  const [accountTab, setAccountTab] = useState<AccountTab>('orders')

  /**
   * Which form the account drawer shows a signed-out visitor.
   *
   * A request, not a preference: it reverts to sign-in whenever the drawer
   * closes. Otherwise a "Save look" prompt that once asked for registration
   * would make the header's profile icon reopen on the registration form
   * forever after.
   */
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  useEffect(() => {
    if (panel === null) setAuthMode('login')
  }, [panel])

  /**
   * Opens the account drawer on a specific section.
   *
   * One call rather than two, because setting the tab and opening the panel
   * separately is an ordering bug waiting to happen: a caller that asks for a
   * section must get it, not whatever section was open the last time the
   * drawer was used.
   */
  const openAccount = useCallback((tab: AccountTab = 'orders') => {
    setAccountTab(tab)
    setPanel('user')
  }, [])

  /** Opens the account drawer on sign-in or on registration, in one call. */
  const openAuth = useCallback((mode: 'login' | 'register' = 'login') => {
    setAuthMode(mode)
    setPanel('user')
  }, [])

  const [supportEntry, setSupportEntry] = useState<SupportEntry>({ view: 'home' })
  const [supportUnread, setSupportUnread] = useState(0)
  /** Opens the support center on its help screen, or straight on the form or
   *  a conversation — one call, for the same reason as openAccount. */
  const openSupport = useCallback((entry?: SupportEntry) => {
    setSupportEntry(entry ?? { view: 'home' })
    setPanel('support')
  }, [])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER)

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

  const setCategoryImage = useCallback(
    async (group: CategoryGroupKey, image: string) => {
      // Optimistic, then reconciled from the server response.
      setCollections((prev) =>
        prev.map((c) => (c.slug === group ? { ...c, image } : c)),
      )
      try {
        const res = await fetch('/api/admin/collections', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: group, image }),
        })
        if (!res.ok) throw new Error((await res.json())?.error ?? 'failed')
      } catch (e) {
        void loadCatalog()
        pushToast({ title: (e as Error).message, variant: 'default' })
      }
    },
    [loadCatalog, pushToast],
  )

  const resetCategoryImage = useCallback(
    async (group: CategoryGroupKey) => {
      setCollections((prev) =>
        prev.map((c) => (c.slug === group ? { ...c, image: undefined } : c)),
      )
      try {
        const res = await fetch('/api/admin/collections', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          // Explicit null clears the stored image; undefined would leave it.
          body: JSON.stringify({ slug: group, image: null }),
        })
        if (!res.ok) throw new Error((await res.json())?.error ?? 'failed')
      } catch (e) {
        void loadCatalog()
        pushToast({ title: (e as Error).message, variant: 'default' })
      }
    },
    [loadCatalog, pushToast],
  )



  // ---------------------------------------------------------------- stock ----
  // A cart line never holds more of a size + colour than exists. Enforced
  // here against the freshest figure known — the server's answer to the last
  // /api/cart/validate when there is one, else the catalogue — and again, for
  // real, by the database when the order is placed (place_order's
  // `stock >= qty`), so a stale page can at worst be told "no" at checkout.

  /** Per-variant stock from the last server check. Cleared when a new
   *  catalogue arrives: that is a newer snapshot until the next check. */
  const [serverStock, setServerStock] = useState<Record<string, number | null>>({})

  const stockLimit = useCallback(
    (productId: string, size: string, color: string): number | null => {
      const product = products.find((p) => p.id === productId)
      if (product?.statuses.includes('out_of_stock')) return 0
      const key = `${productId}|${size}|${color}`
      if (key in serverStock) return serverStock[key]
      return product ? catalogLimit(product, size, color) : null
    },
    [products, serverStock],
  )

  /** The cart as of the last change, readable synchronously: two presses in
   *  the same frame must both see the line the first one added, or a quick
   *  double click on "+" could put a third XL in a basket that allows two. */
  const cartRef = useRef<CartItem[]>(cart)
  useIsomorphicLayoutEffect(() => {
    cartRef.current = cart
  }, [cart])

  const announceStock = useCallback(
    (notes: StockNote[]) => {
      if (notes.length === 0) return
      pushToast({
        title: t('stock.cartChanged'),
        description: notes
          .slice(0, 3)
          .map((n) =>
            n.n > 0
              ? tf('stock.cartReduced', { name: n.name, size: n.size, n: n.n })
              : tf('stock.cartRemoved', { name: n.name, size: n.size }),
          )
          .join(' · '),
        variant: 'default',
      })
    },
    [pushToast, t, tf],
  )

  const validateTimer = useRef<ReturnType<typeof setTimeout>>()
  const validating = useRef(false)
  const validateAgain = useRef(false)
  const validateRef = useRef<() => Promise<void>>(async () => {})

  /** Checks the whole cart against live stock, shortly after the last change. */
  const scheduleValidate = useCallback((delay = 400) => {
    if (validateTimer.current) clearTimeout(validateTimer.current)
    validateTimer.current = setTimeout(() => void validateRef.current(), delay)
  }, [])

  const validateCart = useCallback(async () => {
    const lines = cartRef.current
    if (lines.length === 0) return
    if (validating.current) {
      validateAgain.current = true
      return
    }
    validating.current = true
    try {
      const res = await fetch('/api/cart/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: lines.map(({ productId, size, color, qty }) => ({ productId, size, color, qty })),
        }),
      })
      // Fails open: the order itself is checked by the database.
      if (!res.ok) return
      const data = await res.json().catch(() => null)
      if (!Array.isArray(data?.items)) return
      const fresh: Record<string, number | null> = {}
      for (const it of data.items as { productId: string; size: string; color: string; available: unknown }[]) {
        fresh[`${it.productId}|${it.size}|${it.color}`] = typeof it.available === 'number' ? it.available : null
      }
      setServerStock((prev) => ({ ...prev, ...fresh }))
      const limitOf = (l: CartItem) => {
        const k = `${l.productId}|${l.size}|${l.color}`
        return k in fresh ? fresh[k] : null
      }
      const { notes } = clampToStock(cartRef.current, limitOf)
      if (notes.length) {
        setCart((prev) => clampToStock(prev, limitOf).next)
        announceStock(notes)
      }
    } catch {
      // Offline — the next change or the checkout checks again.
    } finally {
      validating.current = false
      if (validateAgain.current) {
        validateAgain.current = false
        scheduleValidate(0)
      }
    }
  }, [announceStock, scheduleValidate])

  useEffect(() => {
    validateRef.current = validateCart
  }, [validateCart])

  const addToCart = useCallback(
    (item: Omit<CartItem, 'key'>): AddToCartResult => {
      const key = `${item.productId}-${item.size}-${item.color}`
      const limit = stockLimit(item.productId, item.size, item.color)
      const inCart = cartRef.current.find((c) => c.key === key)?.qty ?? 0
      const added = Math.max(0, limit === null ? item.qty : Math.min(item.qty, limit - inCart))
      const onlyNote = limit ? tf('stock.onlyInSize', { n: limit, size: item.size }) : undefined

      if (added === 0) {
        // Calm, not an error: what exists, and that it is already theirs.
        pushToast({
          title: limit === 0 ? t('sold.out') : t('stock.maxInCart'),
          description: onlyNote,
          variant: 'default',
        })
        return { added: 0, limit, inCart }
      }

      // Applied to the ref now (so the next press sees it) and to state
      // through an updater that clamps again against whatever state is.
      const apply = (prev: CartItem[]): CartItem[] => {
        const existing = prev.find((c) => c.key === key)
        const current = existing?.qty ?? 0
        const qty = limit === null ? current + added : Math.min(limit, current + added)
        if (qty <= current) return prev
        return existing
          ? prev.map((c) => (c.key === key ? { ...c, qty } : c))
          : [...prev, { ...item, key, qty }]
      }
      cartRef.current = apply(cartRef.current)
      setCart(apply)
      trackAddToCart({ ...item, qty: added })
      pushToast({
        title: t('toast.addedToCart'),
        description: added < item.qty ? onlyNote : `${item.name} · ${item.size} · ${item.color}`,
        variant: 'gold',
      })
      scheduleValidate()
      return { added, limit, inCart: inCart + added }
    },
    [stockLimit, pushToast, t, tf, scheduleValidate],
  )

  const updateCartQty = useCallback(
    (key: string, qty: number) => {
      const line = cartRef.current.find((c) => c.key === key)
      if (!line) return
      const limit = stockLimit(line.productId, line.size, line.color)
      const ceiling = limit === null ? Infinity : Math.max(1, limit)
      const target = Math.min(Math.max(1, qty), ceiling)
      if (limit !== null && qty > ceiling) {
        pushToast({ title: tf('stock.onlyInSize', { n: limit, size: line.size }), variant: 'default' })
      }
      const apply = (prev: CartItem[]) => prev.map((c) => (c.key === key ? { ...c, qty: target } : c))
      cartRef.current = apply(cartRef.current)
      setCart(apply)
      if (target > line.qty) scheduleValidate()
    },
    [stockLimit, pushToast, tf, scheduleValidate],
  )

  const removeFromCart = useCallback((key: string) => {
    setCart((prev) => {
      const going = prev.find((c) => c.key === key)
      if (going) trackRemoveFromCart(going)
      return prev.filter((c) => c.key !== key)
    })
  }, [])

  const clearCart = useCallback(() => setCart([]), [])

  // ---------------------------------------------------------------- cart ----
  // The cart survives a reload. See lib/cart-storage.ts for why localStorage
  // and not a cookie, and why an attacker-editable cart is harmless here.

  /* Restore. Runs once, before the first paint, so the badge never flashes 0.
     Cannot be an initial useState value: localStorage does not exist during
     SSR, and reading it in the initialiser would make the server and client
     render different markup — a hydration mismatch. */
  const cartRestored = useRef(false)
  useIsomorphicLayoutEffect(() => {
    const saved = readCart()
    if (saved.length > 0) {
      setCart(saved)
      // A basket from last week meets this week's stock.
      scheduleValidate(2500)
    }
    cartRestored.current = true
  }, [scheduleValidate])

  /* Persist on every change. Gated on the restore having run, or this effect's
     own first pass would write the empty initial state over the saved cart
     before the restore above could read it. */
  useEffect(() => {
    if (!cartRestored.current) return
    writeCart(cart)
  }, [cart])

  /* Realign a restored cart with the catalogue once it loads — refreshed
     prices, re-localised names, deleted products dropped. reconcileCart
     returns the same array when nothing moved, so React bails out of the
     update rather than re-rendering every consumer on each catalogue poll. */
  useEffect(() => {
    if (!cartRestored.current) return
    // A new catalogue is a new stock snapshot, and lines are clamped to it —
    // with a notice that says what changed rather than a silent edit.
    setServerStock({})
    const byId = new Map(products.map((p) => [p.id, p]))
    const limitOf = (l: CartItem) => {
      const p = byId.get(l.productId)
      return p ? catalogLimit(p, l.size, l.color) : null
    }
    const { notes } = clampToStock(reconcileCart(cartRef.current, products, localize), limitOf)
    setCart((prev) => clampToStock(reconcileCart(prev, products, localize), limitOf).next)
    announceStock(notes)
  }, [products, localize, announceStock])

  // Opening the basket checks it against live stock.
  useEffect(() => {
    if (panel === 'cart') scheduleValidate(0)
  }, [panel, scheduleValidate])

  /* Keep two open tabs in step. Without this the last tab to write wins, and
     a customer who adds a coat in one tab and a bag in another silently loses
     one of them at checkout. */
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== CART_STORAGE_KEY && event.key !== null) return
      setCart(readCart())
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const cartCount = useMemo(
    () => cart.reduce((sum, c) => sum + c.qty, 0),
    [cart],
  )
  const cartSubtotal = useMemo(
    () => cart.reduce((sum, c) => sum + c.qty * c.price, 0),
    [cart],
  )

  /**
   * Previews a discount code.
   *
   * Was a lookup against a hardcoded two-entry array, so the browser decided
   * whether a code was valid and what it was worth. Coupons now live in
   * Postgres with expiry, usage limits, minimum orders and per-customer
   * scoping, none of which the client can evaluate — and none of which it
   * should, since a discount is money.
   *
   * This call only PREVIEWS. The redemption is consumed once, server-side, at
   * order creation; otherwise abandoning checkout would burn a single-use code.
   */
  const applyPromo = useCallback(
    async (code: string): Promise<Promo | null> => {
      const trimmed = code.trim().toUpperCase()
      if (!trimmed) return null

      try {
        const res = await fetch('/api/coupons/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: trimmed,
            subtotal: cart.reduce((sum, i) => sum + i.price * i.qty, 0),
            productSlugs: cart.map((i) => i.productId),
          }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.ok) return null

        // `percent` is kept in the returned shape because the existing
        // checkout UI displays it. For a fixed-amount coupon it is the
        // effective percentage of this basket, which is what a customer
        // reading "−CHF 20" alongside it would expect it to mean.
        const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0)
        const percent = subtotal > 0 ? Math.round((data.discount / subtotal) * 100) : 0
        return { code: data.code, percent, active: true }
      } catch {
        return null
      }
    },
    [cart],
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
      trackLogin()
      return true
    },
    [pushToast, t],
  )

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const normalized = email.trim().toLowerCase()
      let data, error
      try {
        ;({ data, error } = await createClient().auth.signUp({
          email: normalized,
          password,
          options: {
            // Written to auth.users.raw_user_meta_data. `name` is read by the
            // handle_new_user() trigger to seed public.profiles.name;
            // `language` is what Supabase email templates read as
            // {{ .Data.language }}, which is how a recovery email knows which
            // language to render. It must be stored here because
            // resetPasswordForEmail cannot carry metadata (see below).
            data: { name: name.trim(), language: locale },
            // Without this, Supabase builds the confirmation link from the
            // project's Site URL — which in a fresh project is still
            // http://localhost:3000, so production users get a link pointing
            // at their own machine. /auth/callback exchanges the code for a
            // session and then forwards to the homepage.
            emailRedirectTo: authCallbackUrl('/'),
          },
        }))
      } catch (e) {
        pushToast({ title: (e as Error).message, variant: 'default' })
        return { ok: false, needsConfirmation: false, alreadyRegistered: false }
      }

      if (error) {
        // Some project configurations do surface this as a real error, so the
        // message check stays as a second route to the same conclusion.
        const taken = /already registered|already exists|user already/i.test(error.message)
        return {
          ok: false,
          needsConfirmation: false,
          alreadyRegistered: taken,
          message: taken ? undefined : error.message,
        }
      }

      // Supabase does NOT error on a duplicate email by default — that would
      // let anyone enumerate which addresses have accounts. Instead it returns
      // a user whose `identities` array is empty. Without this check the
      // customer is shown "check your inbox" for an address that is already
      // taken, and no email ever arrives.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        return { ok: false, needsConfirmation: false, alreadyRegistered: true }
      }

      // With "Confirm email" enabled, signUp returns a user but no session:
      // the account exists yet cannot act until the link is clicked. The
      // caller renders a persistent "check your inbox" panel for this case —
      // a toast that vanishes after a few seconds is not enough to explain
      // why the customer is still looking at a sign-in form.
      if (data.user && !data.session) {
        return { ok: true, needsConfirmation: true, alreadyRegistered: false }
      }

      trackSignUp()
      pushToast({ title: t('toast.accountCreated'), variant: 'success' })
      return { ok: true, needsConfirmation: false, alreadyRegistered: false }
    },
    // `locale` is written into the account's signUp metadata, so it has to be
    // a dependency: without it the callback keeps the locale captured when the
    // provider first rendered, and a visitor who switches language before
    // registering has their account — and every transactional email after it —
    // stamped with the language they did not choose.
    [pushToast, t, locale],
  )

  /**
   * Re-sends the sign-up confirmation email.
   *
   * Supabase rate-limits this (roughly one per minute per address) and returns
   * a 429 when exceeded, so the caller shows a cooldown rather than letting
   * someone hammer the button and collect errors.
   */
  const resendConfirmation = useCallback(
    async (email: string) => {
      try {
        const { error } = await createClient().auth.resend({
          type: 'signup',
          email: email.trim().toLowerCase(),
          options: { emailRedirectTo: authCallbackUrl('/') },
        })
        if (error) return { ok: false, message: error.message }
        return { ok: true }
      } catch (e) {
        return { ok: false, message: (e as Error).message }
      }
    },
    [],
  )

  /**
   * Step 1 of OTP recovery: asks Supabase to email a recovery token.
   *
   * IMPORTANT: whether the customer receives a numeric CODE or a clickable
   * LINK is decided entirely by the project's "Reset Password" email template.
   * It must contain {{ .Token }} for this flow to work; the default template
   * ships {{ .ConfirmationURL }}, which produces a link and no code.
   *
   * `redirectTo` is still supplied so that a project left on the default
   * link-style template keeps working through /auth/callback rather than
   * breaking outright.
   *
   * LANGUAGE: metadata cannot be passed here. The SDK signature is
   *   resetPasswordForEmail(email, { redirectTo?, captchaToken? })
   * with no `data` field — adding one is a TypeScript error and would be
   * dropped at runtime. Supabase resolves {{ .Data.language }} from the
   * user's stored raw_user_meta_data, so the locale is written at signUp and
   * refreshed by setLocale() while the user is signed in. By the time someone
   * asks for a reset they are signed out, so there is no session to attach
   * metadata with — it has to already be on the row.
   */
  const requestRecoveryCode = useCallback(async (email: string) => {
    try {
      // Server route, not supabase.auth.resetPasswordForEmail().
      //
      // Supabase's own send works (measured: 200 in ~1.4s), but the body comes
      // from a template in its dashboard — if that template still ships the
      // stock {{ .ConfirmationURL }} the customer gets a link and no code,
      // while this UI asks for a code. And `redirectTo` is silently downgraded
      // to the project's Site URL unless the exact URL is in the dashboard
      // allow-list (verified: the callback URL came back as bare
      // https://luxe-vault.store), so the link landed on the homepage.
      //
      // The route mints the same one-time OTP via admin/generate_link and
      // sends it through Resend, so neither dashboard setting can break it.
      const res = await fetch('/api/auth/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}))
        return { ok: false, message: data.error ?? 'Too many requests' }
      }
      // Any other outcome reports success: the endpoint answers identically
      // for registered and unregistered addresses so it cannot be used to
      // discover which emails have accounts.
      return { ok: true }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }, [])

  /**
   * Step 2: exchanges the emailed code for a session.
   *
   * On success the user is signed in with a recovery session, which is what
   * authorises the updateUser call in step 3. Deliberately does NOT redirect —
   * the whole flow stays on the page the customer started from.
   */
  const verifyRecoveryCode = useCallback(async (email: string, token: string) => {
    try {
      const { error } = await createClient().auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: token.trim(),
        type: 'recovery',
      })
      if (error) return { ok: false, message: error.message }
      return { ok: true }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }, [])

  /** Step 3: sets the new password using the recovery session from step 2. */
  const updatePassword = useCallback(async (password: string) => {
    try {
      const { error } = await createClient().auth.updateUser({ password })
      if (error) return { ok: false, message: error.message }
      return { ok: true }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }, [])

  /**
   * Confirms a newly registered email with the code from the signup email.
   *
   * `type: 'signup'` — not 'recovery'. They are different token namespaces in
   * Supabase, and passing the wrong one fails with "invalid or expired token"
   * even when the digits are right.
   *
   * On success the user is signed in; onAuthStateChange picks that up and the
   * account panel switches over on its own.
   */
  const verifySignupCode = useCallback(async (email: string, token: string) => {
    try {
      const { error } = await createClient().auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: token.trim(),
        type: 'signup',
      })
      if (error) return { ok: false, message: error.message }
      return { ok: true }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }, [])

  /**
   * Starts Google OAuth.
   *
   * Supabase redirects to Google, which returns to /auth/callback with a code
   * that the route handler exchanges for a session. `redirectTo` is built from
   * getSiteUrl() rather than window.location.origin so a preview deployment
   * cannot send the customer back to the wrong host.
   *
   * Resolves only on failure — on success the browser has already navigated
   * away, so there is nothing left to return to.
   */
  const signInWithGoogle = useCallback(async () => {
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: authCallbackUrl('/'),
          // Ask Google for a refresh token and force the account chooser, so a
          // shared device does not silently reuse the previous person's login.
          queryParams: { access_type: 'offline', prompt: 'select_account' },
        },
      })
      if (error) return { ok: false, message: error.message }
      return { ok: true }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await createClient().auth.signOut()
    } catch {
      // Already signed out locally, or Supabase unreachable — the auth state
      // listener clears currentUser either way.
    }
    pushToast({ title: t('toast.loggedOut'), variant: 'default' })
  }, [pushToast, t])

  // Writes go to Postgres via the admin API, then state is set from the row
  // the server actually stored. On failure the optimistic change is rolled
  // back and the real reason is shown — silently dropping a failed save is
  // how an admin ends up believing a product exists when it does not.
  const addProduct = useCallback(
    async (p: Product) => {
      const previous = products
      setProducts((prev) => [p, ...prev])
      try {
        const res = await fetch('/api/admin/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? 'Failed to save product')
        setProducts((prev) => prev.map((x) => (x.id === p.id ? data.product : x)))
        pushToast({ title: t('toast.productAdded'), variant: 'success' })
        return true
      } catch (e) {
        setProducts(previous)
        pushToast({ title: (e as Error).message, variant: 'default' })
        return false
      }
    },
    [products, pushToast, t],
  )

  const updateProduct = useCallback(
    async (p: Product) => {
      const previous = products
      setProducts((prev) => prev.map((x) => (x.id === p.id ? p : x)))
      try {
        const res = await fetch('/api/admin/products', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(p),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? 'Failed to update product')
        setProducts((prev) => prev.map((x) => (x.id === p.id ? data.product : x)))
        pushToast({ title: t('toast.productUpdated'), variant: 'success' })
        return true
      } catch (e) {
        setProducts(previous)
        pushToast({ title: (e as Error).message, variant: 'default' })
        return false
      }
    },
    [products, pushToast, t],
  )

  const deleteProduct = useCallback(
    async (id: string) => {
      const previous = products
      setProducts((prev) => prev.filter((x) => x.id !== id))
      try {
        const res = await fetch(`/api/admin/products?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error ?? 'Failed to delete product')
        }
        pushToast({ title: t('toast.productDeleted'), variant: 'default' })
        return true
      } catch (e) {
        setProducts(previous)
        pushToast({ title: (e as Error).message, variant: 'default' })
        return false
      }
    },
    [products, pushToast, t],
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

  // Memoised so a change to provider state that is NOT part of the context
  // (the server stock snapshot, hydration and metadata flags) no longer
  // re-renders every useStore() consumer on the page. Every member is itself
  // state, a useCallback or a useMemo, so this only recomputes when one of
  // them actually changes.
  const value = useMemo<StoreContextValue>(
    () => ({
      products,
      collections,
      categories,
      categoryTree,
      groupLabels,
      categoryLabels,
      catalogLoading,
      reloadCatalog: loadCatalog,
      shipping,
      categoryImages,
      setCategoryImage,
      resetCategoryImage,
      cart,
      promos,
      currentUser,
      authLoading,
      locale,
      setLocale,
      currency,
      setCurrency,
      exchangeRates,
      t,
      tf,
      localize,
      panel,
      setPanel,
      accountTab,
      setAccountTab,
      openAccount,
      authMode,
      openAuth,
      supportEntry,
      openSupport,
      supportUnread,
      setSupportUnread,
      stockLimit,
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
      wishlist,
      wishlistCount: wishlist.length,
      isWishlisted,
      toggleWishlist,
      cartCount,
      cartSubtotal,
      applyPromo,
      login,
      register,
      resendConfirmation,
      verifySignupCode,
      signInWithGoogle,
      requestRecoveryCode,
      verifyRecoveryCode,
      updatePassword,
      logout,
      addProduct,
      updateProduct,
      deleteProduct,
      addPromo,
      removePromo,
      paymentMethods: PAYMENT_METHODS,
    }),
    [
      products, collections, categories, categoryTree, groupLabels, categoryLabels,
      catalogLoading, loadCatalog, shipping, categoryImages, setCategoryImage,
      resetCategoryImage, cart, promos, currentUser, authLoading, locale, setLocale, currency,
      setCurrency, exchangeRates, t, tf, localize, panel, setPanel, accountTab, setAccountTab, openAccount,
      authMode, openAuth, supportEntry, openSupport, supportUnread, setSupportUnread,
      stockLimit, toasts, query, setQuery, filter, setFilter, pushToast, dismissToast,
      addToCart, updateCartQty, removeFromCart, clearCart, wishlist, isWishlisted, toggleWishlist,
      cartCount, cartSubtotal, applyPromo,
      login, register, resendConfirmation, verifySignupCode, signInWithGoogle,
      requestRecoveryCode, verifyRecoveryCode, updatePassword, logout, addProduct,
      updateProduct, deleteProduct, addPromo, removePromo,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
