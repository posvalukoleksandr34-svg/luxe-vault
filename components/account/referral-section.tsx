'use client'

import { Check, Copy, Mail, MessageCircle, Send } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LoadError } from '@/components/load-error'
import type { ReferralOverview, ReferralStatus } from '@/lib/referral-program'
import { formatPrice, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

type Loaded = Extract<ReferralOverview, { available: true }>

const STATUS_KEY = {
  pending: 'ref.status.pending',
  order_placed: 'ref.status.order_placed',
  reward_paid: 'ref.status.reward_paid',
  void: 'ref.status.void',
} as const

const STATUS_TONE: Record<ReferralStatus, string> = {
  pending: 'text-foreground/55',
  order_placed: 'text-foreground/80',
  reward_paid: 'text-foreground',
  void: 'text-foreground/40',
}

/**
 * "Invite a friend": the offer, the customer's link with copy and share, the
 * three figures that matter, and who they invited.
 *
 * Everything shown comes from /api/referrals/me — the code, the terms, the
 * counts and the history — so the page cannot promise an offer the server
 * does not apply. Friends appear masked ("an•••@g•••.com"). Until migration
 * 0036 is applied the section says the programme is not open yet.
 */
export function ReferralSection() {
  const { t, tf, locale, pushToast } = useStore()
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'failed' } | { kind: 'unavailable' } | { kind: 'ready'; data: Loaded }
  >({ kind: 'loading' })
  const [copied, setCopied] = useState(false)
  const linkRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await fetch('/api/referrals/me', { cache: 'no-store' })
      if (!res.ok) return setState({ kind: 'failed' })
      const data = (await res.json()) as ReferralOverview
      setState(data.available ? { kind: 'ready', data } : { kind: 'unavailable' })
    } catch {
      setState({ kind: 'failed' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      pushToast({ title: t('ref.copied'), variant: 'success' })
    } catch {
      // No clipboard permission (an insecure origin, an old webview): select
      // the link so a long-press or Ctrl+C finishes the job.
      linkRef.current?.focus()
      linkRef.current?.select()
      pushToast({ title: t('ref.copyFailed'), variant: 'default' })
    }
  }

  if (state.kind === 'loading') {
    return (
      <div className="space-y-4" aria-busy="true" aria-label={t('common.loading')}>
        <div className="h-[260px] animate-pulse border border-white/10 bg-white/[0.02]" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[132px] animate-pulse border border-white/10 bg-white/[0.02]" />
          ))}
        </div>
      </div>
    )
  }

  if (state.kind === 'failed') {
    return <LoadError title={t('ref.loadFailed')} onRetry={load} />
  }

  if (state.kind === 'unavailable') {
    return (
      <div className="max-w-xl border border-white/10 p-6">
        <p className="t-label text-foreground/50">{t('acct.soon')}</p>
        <p className="mt-3 text-[14px] font-light leading-relaxed text-foreground/75">{t('acct.referralSoon')}</p>
      </div>
    )
  }

  const { data } = state
  const reward = formatPrice(data.rewardAmount)
  const message = `${tf('ref.shareMessage', { percent: data.discountPercent })} ${data.link}`
  const share = [
    {
      key: 'telegram',
      label: 'Telegram',
      icon: Send,
      href: `https://t.me/share/url?url=${encodeURIComponent(data.link)}&text=${encodeURIComponent(
        tf('ref.shareMessage', { percent: data.discountPercent }),
      )}`,
    },
    { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, href: `https://wa.me/?text=${encodeURIComponent(message)}` },
    {
      key: 'email',
      label: 'Email',
      icon: Mail,
      href: `mailto:?subject=${encodeURIComponent(tf('ref.shareSubject', { percent: data.discountPercent }))}&body=${encodeURIComponent(message)}`,
    },
  ]

  const dateFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' })
  const shareButton =
    'inline-flex min-h-[44px] items-center gap-2 border border-white/10 px-4 text-[13px] font-light text-foreground/80 transition-colors hover:border-white/30 hover:text-foreground'

  return (
    <div className="space-y-10">
      {/* The offer and the link. */}
      <section className="border border-white/10 p-6 sm:p-8">
        <h2 className="max-w-2xl text-balance font-serif text-[26px] font-normal leading-[1.15] tracking-tight text-foreground sm:text-[34px]">
          {tf('ref.heroTitle', { percent: data.discountPercent, reward })}
        </h2>
        <p className="mt-4 max-w-xl text-[14px] font-light leading-relaxed text-foreground/65">{t('ref.heroHow')}</p>

        <div className="mt-8 border-t border-white/10 pt-6">
          <label htmlFor="referral-link" className="t-label mb-2 block text-foreground/55">
            {t('ref.linkLabel')}
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-0">
            <input
              ref={linkRef}
              id="referral-link"
              readOnly
              value={data.link}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-[48px] w-full min-w-0 border border-white/10 bg-transparent px-4 text-[14px] font-light text-foreground outline-none focus:border-white/40 sm:border-r-0"
            />
            <button
              type="button"
              onClick={() => void copyLink(data.link)}
              className="t-cta inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 bg-foreground px-7 text-background transition-colors hover:bg-foreground/85"
            >
              {copied ? <Check className="size-3.5" strokeWidth={2} aria-hidden /> : <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />}
              {copied ? t('ref.copied') : t('ref.copy')}
            </button>
          </div>
          <p className="t-meta mt-2 text-foreground/45">
            {t('ref.codeLabel')}: <span className="tabular-nums tracking-wider text-foreground/75">{data.code}</span>
          </p>

          <p className="t-label mb-3 mt-6 text-foreground/55">{t('ref.shareVia')}</p>
          <div className="flex flex-wrap gap-2">
            {share.map(({ key, label, icon: Icon, href }) => (
              <a
                key={key}
                href={href}
                target={key === 'email' ? undefined : '_blank'}
                rel={key === 'email' ? undefined : 'noopener noreferrer'}
                className={shareButton}
              >
                <Icon className="size-4" strokeWidth={1.25} aria-hidden />
                {label}
              </a>
            ))}
            <button type="button" onClick={() => void copyLink(data.link)} className={shareButton}>
              <Copy className="size-4" strokeWidth={1.25} aria-hidden />
              {t('ref.shareCopy')}
            </button>
          </div>
        </div>
      </section>

      {/* The three figures. */}
      <section aria-label={t('acct.referral')}>
        <ul className="grid gap-4 sm:grid-cols-3">
          <Stat label={t('ref.statInvited')} value={String(data.stats.invited)} sub={tf('ref.statClicks', { n: data.stats.clicks })} />
          <Stat label={t('ref.statPurchases')} value={String(data.stats.purchases)} />
          <Stat label={t('ref.statEarned')} value={formatPrice(data.stats.earned)} />
        </ul>
      </section>

      {/* Who was invited. */}
      <section aria-labelledby="referral-history-title">
        <h2
          id="referral-history-title"
          className="mb-5 font-serif text-[24px] font-normal tracking-tight text-foreground sm:text-[28px]"
        >
          {t('ref.historyTitle')}
        </h2>

        {data.history.length === 0 ? (
          <p className="border-y border-white/10 py-6 text-[14px] font-light text-foreground/60">{t('ref.historyEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/10">
                  {[t('ref.colFriend'), t('ref.colStatus'), t('ref.colDate'), t('ref.colReward')].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn('t-label py-3 pr-4 font-normal text-foreground/50', i === 3 && 'pr-0 text-right')}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.history.map((row) => (
                  <tr key={row.id} className="border-b border-white/10">
                    <td className="py-4 pr-4 text-[14px] font-light text-foreground/85">{row.friend}</td>
                    <td className={cn('py-4 pr-4 text-[13px] font-light', STATUS_TONE[row.status])}>
                      {t(STATUS_KEY[row.status])}
                    </td>
                    <td className="py-4 pr-4 text-[13px] font-light tabular-nums text-foreground/60">
                      {dateFmt.format(new Date(row.date))}
                    </td>
                    <td className="py-4 text-right text-[14px] font-light tabular-nums text-foreground/85">
                      {row.reward > 0 ? formatPrice(row.reward) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="max-w-2xl text-[12px] font-light leading-relaxed text-foreground/45">{t('ref.terms')}</p>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <li className="flex flex-col border border-white/10 p-6">
      <span className="t-label text-foreground/55">{label}</span>
      <span className="mt-4 font-serif text-[36px] font-normal leading-none tabular-nums text-foreground">{value}</span>
      {sub && <span className="t-meta mt-3 text-foreground/45">{sub}</span>}
    </li>
  )
}
