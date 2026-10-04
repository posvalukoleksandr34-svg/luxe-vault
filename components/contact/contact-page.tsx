'use client'

import { ArrowRight, Clock, Mail, MapPin, Phone, Send } from 'lucide-react'
import { Link } from '@/components/locale-link'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { SupportRequestForm } from '@/components/contact/support-request-form'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { BUSINESS } from '@/config/business'
import { CONTACT_COPY, fillCopy } from '@/lib/contact-copy'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { useStore } from '@/lib/store'

/**
 * /contact — every way to reach the shop, and the form, on one page.
 *
 * Only channels that exist: email (the support inbox), Telegram (staffed),
 * and a phone line only when NEXT_PUBLIC_SUPPORT_PHONE is set. The response
 * time is the target in lib/fulfilment.ts, the same figure every other page
 * quotes.
 */
export function ContactPage() {
  const { locale, t } = useStore()
  const c = CONTACT_COPY[locale]
  const replySpan = describeBusinessDays(FULFILMENT.supportReply, locale)

  const rows = [
    {
      icon: Mail,
      label: c.emailLabel,
      value: (
        <a href={`mailto:${BUSINESS.email}`} className="underline decoration-foreground/30 underline-offset-[6px] hover:decoration-gold">
          {BUSINESS.email.split('@')[0]}@<wbr />{BUSINESS.email.split('@')[1]}
        </a>
      ),
    },
    ...(BUSINESS.phone
      ? [
          {
            icon: Phone,
            label: c.phoneLabel,
            value: (
              <>
                <a href={`tel:${BUSINESS.phone.replace(/[^\d+]/g, '')}`} className="tabular-nums underline decoration-foreground/30 underline-offset-[6px] hover:decoration-gold">
                  {BUSINESS.phone}
                </a>
                {BUSINESS.phoneHours && <span className="t-meta mt-1 block text-foreground/70">{BUSINESS.phoneHours}</span>}
              </>
            ),
          },
        ]
      : []),
    {
      icon: Send,
      label: c.telegramLabel,
      value: (
        <a href={BUSINESS.telegramUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-foreground/30 underline-offset-[6px] hover:decoration-gold">
          {BUSINESS.telegram}
        </a>
      ),
    },
    { icon: Clock, label: c.responseLabel, value: fillCopy(c.responseBody, { span: replySpan }) },
    { icon: MapPin, label: t('footer.imprint'), value: <Link href="/legal/imprint" className="underline decoration-foreground/30 underline-offset-[6px] hover:decoration-gold">{t('footer.basedIn')}</Link> },
  ]

  return (
    <>
      <Header />
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
        <Breadcrumbs
          trail={[
            { name: 'Luxe Vault', url: '/' },
            { name: c.pageTitle, url: '/contact' },
          ]}
        />

        <header className="border-b border-border pb-10">
          <h1 className="text-balance font-serif text-[36px] font-normal leading-[1.05] tracking-tight text-foreground sm:text-[52px]">
            {c.pageTitle}
          </h1>
          <p className="mt-4 max-w-xl text-[15px] font-light leading-relaxed text-foreground/75">{c.pageIntro}</p>
        </header>

        <div className="grid gap-10 py-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14 lg:py-14">
          <section aria-labelledby="contact-details">
            <h2 id="contact-details" className="font-serif text-[24px] font-normal tracking-tight text-foreground sm:text-[28px]">
              {c.detailsTitle}
            </h2>
            <dl className="mt-6 divide-y divide-border/60 border-y border-border/60">
              {rows.map(({ icon: Icon, label, value }) => (
                <div key={label} className="py-4">
                  <dt className="t-label flex items-center gap-3 text-muted-foreground">
                    <Icon className="size-4 shrink-0 text-gold" strokeWidth={1.5} aria-hidden />
                    {label}
                  </dt>
                  <dd className="mt-1.5 min-w-0 pl-7 text-[15px] font-light text-foreground">{value}</dd>
                </div>
              ))}
            </dl>

            <ul className="mt-8 space-y-1">
              {[
                { href: '/faq', label: t('footer.faq') },
                { href: '/shipping', label: t('footer.shipping') },
                { href: '/legal/refunds', label: t('footer.returnsRefunds') },
                { href: '/support', label: c.helpCenter },
              ].map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="group inline-flex min-h-[44px] items-center gap-2 text-[14px] text-foreground/85 transition-colors hover:text-foreground"
                  >
                    {l.label}
                    <ArrowRight className="size-3.5 text-gold transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={1.25} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <SupportRequestForm c={c} replySpan={replySpan} />
        </div>
      </main>
      <Footer />
    </>
  )
}
