'use client'

import { ArrowRight, ChevronDown, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { AccountOrders } from '@/components/account-orders'
import { CuratedVaults } from '@/components/account/curated-vaults'
import { PasswordForm } from '@/components/account/password-form'
import { ProfileForm } from '@/components/account/profile-form'
import { ReferralSection } from '@/components/account/referral-section'
import {
  ACCOUNT_SECTIONS,
  CARD_ORDER,
  accountHref,
  isAccountSection,
  type AccountSectionKey,
} from '@/components/account/sections'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { MotionToggle } from '@/components/motion-toggle'
import { SavedAddresses } from '@/components/saved-addresses'
import { SavedCards } from '@/components/saved-cards'
import { SoundToggle } from '@/components/sound-toggle'
import { openCookieSettings } from '@/lib/cookie-settings'
import { CURRENCY_CODES, CURRENCY_NAME_KEY } from '@/lib/currency'
import { STOREFRONT_LOCALES } from '@/lib/i18n'
import { loadMyOrders } from '@/lib/order-registry'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { CurrencyCode } from '@/lib/currency'
import type { Order, StorefrontLocale } from '@/lib/types'

/**
 * The account.
 *
 * /account is the overview: a greeting and the account's sections as outlined
 * cards. /account?section=… is one section, with a rail of all of them beside
 * it. The section lives in the query string so a customer can be sent
 * straight to /account?section=orders, and so the header menu is plain links.
 *
 * The account drawer (components/user-panel.tsx) stays for the quick path —
 * sign-in, and an order mid-browse. Both read the same components, so there is
 * one implementation of each thing rather than two that drift.
 *
 * The referral programme and the bonus balance it feeds are real (migration
 * 0036); until that migration is applied they say so plainly.
 *
 * An unknown section — including the retired `loyalty` — is not an error page:
 * the address is replaced with /account and the overview shows.
 */

/** The old `?tab=` values, so links and bookmarks from before still land. */
const LEGACY_TABS: Record<string, AccountSectionKey> = {
  profile: 'details',
  settings: 'details',
  orders: 'orders',
  vaults: 'looks',
  addresses: 'addresses',
}

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <Spinner />
        </Shell>
      }
    >
      <Account />
    </Suspense>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        {children}
      </main>
      <Footer />
    </>
  )
}

function Spinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="size-5 animate-spin text-foreground/40" />
    </div>
  )
}

function Account() {
  const { currentUser, authLoading, t, setPanel } = useStore()
  const params = useSearchParams()
  const router = useRouter()

  const requested = params.get('section')
  const legacy = params.get('tab')
  const section: AccountSectionKey | null = isAccountSection(requested)
    ? requested
    : legacy && LEGACY_TABS[legacy]
      ? LEGACY_TABS[legacy]
      : null

  // A section that does not exist (a retired one such as `loyalty`, an old
  // bookmark, a typo): the overview is already showing, so drop the stale
  // query rather than leave a URL that names something not on the page.
  const stale = (requested !== null || legacy !== null) && section === null
  useEffect(() => {
    if (stale) router.replace('/account', { scroll: false })
  }, [stale, router])

  // Waiting for the session to settle, so an already-signed-in customer is
  // never shown the sign-in prompt for a frame.
  if (authLoading) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    )
  }

  if (!currentUser) {
    return (
      <Shell>
        <div className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-6 text-center">
          <h1 className="font-serif text-[32px] font-normal tracking-tight text-foreground">{t('account.title')}</h1>
          <p className="text-[14px] font-light text-foreground/65">{t('account.signInRequired')}</p>
          <button
            type="button"
            onClick={() => setPanel('user')}
            className="t-cta inline-flex min-h-[48px] items-center justify-center bg-foreground px-10 text-background transition-colors hover:bg-foreground/85"
          >
            {t('user.login')}
          </button>
        </div>
      </Shell>
    )
  }

  return <Shell>{section ? <SectionView section={section} /> : <Overview />}</Shell>
}

// ----------------------------------------------------------------- overview

function Overview() {
  const { currentUser, t, tf, logout } = useStore()
  const firstName = (currentUser?.name ?? '').trim().split(/\s+/)[0] || currentUser?.name || ''

  const cards = CARD_ORDER.map((key) => ACCOUNT_SECTIONS.find((s) => s.key === key)!).filter((s) => s.card)

  return (
    <>
      <Breadcrumbs
        trail={[
          { name: t('common.home'), url: '/' },
          { name: t('account.title'), url: '/account' },
        ]}
      />

      <h1 className="text-balance font-serif text-[36px] font-normal leading-[1.08] tracking-tight text-foreground sm:text-[48px]">
        {tf('acct.greeting', { name: firstName })}
      </h1>
      <p className="mt-3 text-[13px] font-light text-foreground/50">{currentUser?.email}</p>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:mt-12">
        {cards.map((s) => (
          <li key={s.key}>
            <Link
              href={accountHref(s.key)}
              className="group flex h-full min-h-[148px] flex-col border border-white/10 bg-transparent p-6 transition-colors duration-200 hover:border-white/30 focus-visible:border-white/50 focus-visible:outline-none"
            >
              <span className="flex items-start justify-between gap-4">
                <span className="text-[13px] font-normal uppercase tracking-[0.16em] text-foreground">
                  {t(s.card!.titleKey)}
                </span>
                <ArrowRight
                  className="mt-0.5 size-4 shrink-0 text-foreground/35 transition-[color,transform] duration-300 group-hover:translate-x-1 group-hover:text-foreground/80"
                  strokeWidth={1.25}
                  aria-hidden
                />
              </span>
              <span className="mt-3 max-w-sm text-[14px] font-light leading-relaxed text-foreground/60">
                {t(s.card!.descKey)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* The sections without a card, and sign-out: quiet, below the grid. */}
      <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-white/10 pt-6">
        {(['settings', 'credits', 'looks'] as AccountSectionKey[]).map((key) => (
          <Link
            key={key}
            href={accountHref(key)}
            className="inline-flex min-h-[44px] items-center text-[13px] font-light text-foreground/65 underline decoration-white/20 underline-offset-[6px] transition-colors hover:text-foreground hover:decoration-white"
          >
            {t(ACCOUNT_SECTIONS.find((s) => s.key === key)!.labelKey)}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => void logout()}
          className="ml-auto inline-flex min-h-[44px] items-center text-[13px] font-light text-foreground/50 transition-colors hover:text-foreground"
        >
          {t('user.logout')}
        </button>
      </div>
    </>
  )
}

// ------------------------------------------------------------------ section

function SectionView({ section }: { section: AccountSectionKey }) {
  const { t } = useStore()
  const current = ACCOUNT_SECTIONS.find((s) => s.key === section)!

  return (
    <>
      <Breadcrumbs
        trail={[
          { name: t('common.home'), url: '/' },
          { name: t('account.title'), url: '/account' },
          { name: t(current.labelKey), url: accountHref(section) },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[240px_1fr] lg:gap-14">
        {/* The rail. A horizontal scroller on phones, where a 240px column
            would take most of the screen. */}
        <nav aria-label={t('acct.sections')} className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
          <ul className="flex gap-6 border-b border-white/10 lg:flex-col lg:gap-0 lg:border-b-0 lg:border-l">
            <li>
              <Link
                href="/account"
                className="flex min-h-[44px] shrink-0 items-center whitespace-nowrap text-[13px] font-light text-foreground/55 transition-colors hover:text-foreground lg:-ml-px lg:border-l lg:border-transparent lg:pl-5"
              >
                {t('account.title')}
              </Link>
            </li>
            {ACCOUNT_SECTIONS.map((s) => {
              const active = s.key === section
              return (
                <li key={s.key}>
                  <Link
                    href={accountHref(s.key)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-[44px] shrink-0 items-center whitespace-nowrap border-b text-[13px] font-light transition-colors lg:-ml-px lg:border-b-0 lg:border-l lg:pl-5',
                      active
                        ? 'border-foreground text-foreground'
                        : 'border-transparent text-foreground/55 hover:text-foreground',
                    )}
                  >
                    {t(s.labelKey)}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          <h1 className="mb-8 font-serif text-[32px] font-normal leading-tight tracking-tight text-foreground sm:text-[40px]">
            {t(current.labelKey)}
          </h1>

          {section === 'orders' && <OrdersSection />}
          {section === 'details' && (
            <div className="max-w-xl space-y-4">
              <ProfileForm />
              <PasswordForm />
            </div>
          )}
          {section === 'addresses' && (
            <div className="max-w-xl space-y-4">
              <SavedAddresses />
              <SavedCards />
            </div>
          )}
          {section === 'looks' && <CuratedVaults />}
          {section === 'settings' && <SettingsSection />}
          {section === 'referral' && <ReferralSection />}
          {section === 'credits' && <CreditsSection />}
        </div>
      </div>
    </>
  )
}

function CreditsSection() {
  const { t } = useStore()
  // The referral bonus balance (account_credits). Null while loading, or when
  // the ledger is not there yet — then the section reads as it always did.
  const [balance, setBalance] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/account/credits', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.available) setBalance(Number(data.balance) || 0)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="max-w-xl border border-white/10 p-6">
      {balance !== null && balance > 0 ? (
        <>
          <p className="t-label text-foreground/55">{t('acct.creditsBalance')}</p>
          <p className="mt-3 font-serif text-[36px] font-normal leading-none tabular-nums text-foreground">
            {formatPrice(balance)}
          </p>
          <p className="mt-4 text-[14px] font-light leading-relaxed text-foreground/65">{t('acct.creditsSpendSoon')}</p>
          <div className="my-6 border-t border-white/10" />
        </>
      ) : (
        <p className="text-[15px] font-normal text-foreground">{t('acct.creditsEmpty')}</p>
      )}
      <p className="mt-3 text-[14px] font-light leading-relaxed text-foreground/65">{t('acct.creditsHint')}</p>
      <Link
        href={accountHref('orders')}
        className="group mt-5 inline-flex min-h-[44px] items-center gap-2 text-[13px] text-foreground/85 underline decoration-white/25 underline-offset-[6px] transition-colors hover:text-foreground hover:decoration-white"
      >
        {t('acct.orders')}
        <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={1.25} aria-hidden />
      </Link>
    </div>
  )
}

/** Language, currency, sound and motion, cookies — the preferences that
 *  already exist elsewhere on the site, gathered in one place. */
function SettingsSection() {
  const { t, locale, setLocale, currency, setCurrency } = useStore()

  return (
    <div className="max-w-xl divide-y divide-white/10 border-y border-white/10">
      <SettingRow label={t('acct.language')} htmlFor="pref-language">
        <SelectField id="pref-language" value={locale} onChange={(v) => setLocale(v as StorefrontLocale)}>
          {STOREFRONT_LOCALES.map((l) => (
            <option key={l.code} value={l.code} className="bg-background text-foreground">
              {l.label}
            </option>
          ))}
        </SelectField>
      </SettingRow>

      <SettingRow label={t('acct.currency')} htmlFor="pref-currency">
        <SelectField id="pref-currency" value={currency} onChange={(v) => setCurrency(v as CurrencyCode)}>
          {CURRENCY_CODES.map((code) => (
            <option key={code} value={code} className="bg-background text-foreground">
              {code} · {t(CURRENCY_NAME_KEY[code])}
            </option>
          ))}
        </SelectField>
      </SettingRow>

      <SettingRow label={t('acct.experience')}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <SoundToggle />
          <MotionToggle />
        </div>
      </SettingRow>

      <SettingRow label={t('acct.privacy')}>
        <button
          type="button"
          onClick={openCookieSettings}
          className="inline-flex min-h-[44px] items-center text-[13px] font-light text-foreground/80 underline decoration-white/25 underline-offset-[6px] transition-colors hover:text-foreground hover:decoration-white"
        >
          {t('acct.cookies')}
        </button>
      </SettingRow>
    </div>
  )
}

function SettingRow({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-3 py-5 sm:grid-cols-[180px_1fr] sm:items-center sm:gap-6">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="t-label text-foreground/55">
          {label}
        </label>
      ) : (
        <span className="t-label text-foreground/55">{label}</span>
      )}
      <div>{children}</div>
    </div>
  )
}

function SelectField({
  id,
  value,
  onChange,
  children,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <div className="relative max-w-xs">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full cursor-pointer appearance-none border border-white/10 bg-transparent pl-4 pr-11 text-base font-light text-foreground outline-none transition-colors hover:border-white/20 focus:border-white/50 focus-visible:outline-none md:text-[14px]"
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-foreground/50"
        strokeWidth={1.25}
        aria-hidden
      />
    </div>
  )
}

// ------------------------------------------------------------------- orders

function OrdersSection() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const result = await loadMyOrders()
      // Keep whatever we already had if a refresh fails — see the drawer.
      if (result.ok) setOrders(result.orders)
      setFailed(!result.ok)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // The same component the drawer uses, so the status timeline, the pay-now
  // retry, cancellation and refund requests all behave identically in both
  // places rather than being implemented twice.
  return (
    <AccountOrders
      orders={orders}
      loading={loading}
      failed={failed && orders.length === 0}
      onReload={load}
    />
  )
}
