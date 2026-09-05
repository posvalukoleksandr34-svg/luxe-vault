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
import { authCallbackUrl } from './site-url'
import { createClient } from './supabase/client'
import { isSupabaseConfigured } from './supabase/env'
import { CATEGORY_TREE, DEFAULT_CATEGORY_IMAGES, PAYMENT_METHODS, SEED_PROMOS } from './data'
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
  collections: Collection[]
  categories: Category[]
  categoryTree: { group: CategoryGroupKey; items: CategoryKey[] }[]
  groupLabels: Record<string, LocalizedText>
  categoryLabels: Record<string, LocalizedText>
  catalogLoading: boolean
  reloadCatalog: () => Promise<void>
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
  t: (key: UIKey) => string
  /** Localized string with {placeholder} substitution, e.g.
   *  tf('otp.step2.resendIn', { n: 42 }). Values are inserted verbatim, so
   *  never pass anything that will be rendered as HTML. */
  tf: (key: UIKey, vars: Record<string, string | number>) => string
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
  const [products, setProducts] = useState<Product[]>([])
  const [productsHydrated, setProductsHydrated] = useState(false)
  const [collections, setCollections] = useState<Collection[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [cart, setCart] = useState<CartItem[]>([])
  const [promos, setPromos] = useState<Promo[]>(SEED_PROMOS)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [metadataLanguage, setMetadataLanguage] = useState<string | null>(null)

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

      pushToast({ title: t('toast.accountCreated'), variant: 'success' })
      return { ok: true, needsConfirmation: false, alreadyRegistered: false }
    },
    [pushToast, t],
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
   * IMPORTANT: whether the customer receives a 6-digit CODE or a clickable
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
      const { error } = await createClient().auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: authCallbackUrl('/auth/update-password') },
      )
      if (error) return { ok: false, message: error.message }
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

  const value: StoreContextValue = {
    products,
    collections,
    categories,
    categoryTree,
    groupLabels,
    categoryLabels,
    catalogLoading,
    reloadCatalog: loadCatalog,
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
    tf,
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
    resendConfirmation,
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
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
