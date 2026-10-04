'use client'

import { Link } from '@/components/locale-link'
import { InfoCallout, InfoPage, InfoSection } from '@/components/info/info-page'
import { SHIPPING } from '@/lib/content/shipping'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { fill } from '@/lib/support/copy'
import { formatPrice, useStore } from '@/lib/store'

export function ShippingPage() {
  const { locale, shipping, t } = useStore()
  const c = SHIPPING[locale] ?? SHIPPING.en
  // The admin's live figures (store_settings) — the same ones the cart and the
  // checkout charge, so this page cannot drift from them.
  const vars = {
    span: describeBusinessDays(shipping.deliveryTimeframe, locale),
    price: formatPrice(shipping.shippingPrice, true),
    amount: formatPrice(shipping.freeShippingThreshold),
    reply: describeBusinessDays(FULFILMENT.supportReply, locale, { genitive: true }),
  }
  const facts = [c.facts.origin, c.facts.carrier, c.facts.time, c.facts.cost]

  return (
    <InfoPage path="/shipping" eyebrow={c.eyebrow} title={c.title} lead={c.lead}>
      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 my-10">
        {facts.map(([label, value]) => (
          <div key={label} className="bg-background p-5">
            <dt className="t-label text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-[16px] text-foreground">{fill(value, vars)}</dd>
          </div>
        ))}
      </dl>

      {c.sections.map((s) => (
        <InfoSection key={s.id} id={s.id} title={s.h}>
          {s.body.map((p) => (
            <p key={p}>{fill(p, vars)}</p>
          ))}
          {s.id === 'problems' && (
            <p>
              <Link href="/legal/refunds" className="text-foreground underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
                {t('footer.refunds')} →
              </Link>
            </p>
          )}
        </InfoSection>
      ))}

      <InfoCallout
        title={c.title}
        body={fill(c.questions, vars)}
        primary={{ href: '/contact', label: c.contactCta }}
        secondary={{ href: '/faq', label: c.faqCta }}
      />
    </InfoPage>
  )
}
