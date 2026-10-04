'use client'

import { Link } from '@/components/locale-link'
import { InfoCallout, InfoPage, InfoSection } from '@/components/info/info-page'
import { BUSINESS } from '@/config/business'
import { ABOUT } from '@/lib/content/about'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { useStore } from '@/lib/store'

export function AboutPage() {
  const { locale, t } = useStore()
  const c = ABOUT[locale] ?? ABOUT.en
  const reply = describeBusinessDays(FULFILMENT.supportReply, locale, { genitive: true })

  return (
    <InfoPage path="/about" eyebrow={c.eyebrow} title={c.title} lead={c.lead}>
      <InfoSection title={c.whoTitle}>
        <p>
          {BUSINESS.legalName ? c.whoNamed.replace('{name}', BUSINESS.legalName) : c.whoAnonymous}{' '}
          <Link href="/legal/imprint" className="text-foreground underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
            {t('footer.imprint')}
          </Link>
        </p>
      </InfoSection>

      {c.sections.map((s) => (
        <InfoSection key={s.h} title={s.h}>
          {s.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </InfoSection>
      ))}

      <InfoCallout
        title={c.contactTitle}
        body={c.contactBody.replace('{span}', reply)}
        primary={{ href: '/contact', label: c.contactCta }}
        secondary={{ href: '/catalog', label: c.shopCta }}
      />
    </InfoPage>
  )
}
