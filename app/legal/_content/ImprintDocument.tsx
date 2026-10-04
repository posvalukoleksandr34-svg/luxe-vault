'use client'

import { Link } from '@/components/locale-link'
import { BUSINESS, hasPostalAddress } from '@/config/business'
import { IMPRINT } from '@/lib/content/imprint'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { useStore } from '@/lib/store'

/**
 * The Imprint. Every row is the seller's configured information
 * (config/business.ts); a row with nothing configured is left out rather than
 * shown as a placeholder, so the page is always finished as far as it goes.
 */
export function ImprintDocument() {
  const { locale, t } = useStore()
  const c = IMPRINT[locale] ?? IMPRINT.en
  const span = describeBusinessDays(FULFILMENT.supportReply, locale)

  const rows: { label: string; value: React.ReactNode }[] = []
  if (BUSINESS.legalName) rows.push({ label: c.seller, value: BUSINESS.legalName })
  rows.push({ label: c.tradingAs, value: BUSINESS.tradingName })
  rows.push({
    label: c.address,
    value: hasPostalAddress() ? (
      <>
        {BUSINESS.street}
        <br />
        {BUSINESS.postcode} {BUSINESS.city}
        <br />
        {BUSINESS.country}
      </>
    ) : (
      [BUSINESS.city, BUSINESS.country].filter(Boolean).join(', ')
    ),
  })
  rows.push({ label: c.email, value: <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> })
  if (BUSINESS.phone) {
    rows.push({
      label: c.phone,
      value: <a href={`tel:${BUSINESS.phone.replace(/[^\d+]/g, '')}`}>{BUSINESS.phone}</a>,
    })
  }
  rows.push({
    label: c.telegram,
    value: (
      <a href={BUSINESS.telegramUrl} target="_blank" rel="noopener noreferrer">
        {BUSINESS.telegram}
      </a>
    ),
  })
  if (BUSINESS.uid) rows.push({ label: c.uid, value: BUSINESS.uid })
  if (BUSINESS.responsiblePerson) rows.push({ label: c.responsible, value: BUSINESS.responsiblePerson })

  return (
    <>
      <h1>{c.title}</h1>
      <p>{BUSINESS.legalName ? c.intro.replace('{name}', BUSINESS.legalName) : c.introAnonymous}</p>

      <section>
        <h2>{c.operatorHeading}</h2>
        <dl className="not-prose divide-y divide-border/50 border-y border-border/50">
          {rows.map((row) => (
            <div key={row.label} className="grid gap-1 py-3 sm:grid-cols-[200px_1fr] sm:gap-6">
              <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{row.label}</dt>
              <dd className="text-[14px] text-foreground [&_a]:text-foreground [&_a]:underline [&_a]:decoration-gold/50 [&_a]:underline-offset-4">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2>{c.contactHeading}</h2>
        <p>{c.contactBody.replace('{span}', span)}</p>
        <p>
          <Link href="/contact">{c.contactLink} →</Link>
        </p>
      </section>

      <section>
        <h2>{c.productsHeading}</h2>
        <p>{c.productsBody}</p>
      </section>

      <section>
        <h2>{c.policiesHeading}</h2>
        <p>{c.policiesBody}</p>
        <ul>
          <li><Link href="/legal/terms">{t('footer.terms')}</Link></li>
          <li><Link href="/legal/refunds">{t('footer.refunds')}</Link></li>
          <li><Link href="/shipping">{t('footer.delivery')}</Link></li>
          <li><Link href="/legal/privacy">{t('footer.privacy')}</Link></li>
        </ul>
      </section>
    </>
  )
}
