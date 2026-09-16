'use client'

import { ArrowRight } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { ContactMethods } from '@/components/contact/contact-methods'
import { NewsletterBlock } from '@/components/contact/newsletter-block'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { CONTACT_COPY } from '@/lib/contact-copy'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { useStore } from '@/lib/store'

// The form — with the country list and attachment handling — loads when it
// is first opened, not with the page.
const SupportRequestModal = dynamic(
  () => import('@/components/contact/support-request-modal').then((m) => m.SupportRequestModal),
  { ssr: false },
)

/** The hash that opens the form on arrival, so other pages can link to it. */
const FORM_HASH = '#request'

/**
 * /contact — "Помощь и контакты".
 *
 * Deliberately plain: monochrome type, 1px hairlines, one solid button per
 * view. The page title, the two ways to reach us, then the newsletter.
 */
export function ContactPage() {
  const { locale } = useStore()
  const c = CONTACT_COPY[locale]
  const replySpan = describeBusinessDays(FULFILMENT.supportReply, locale)

  const [formOpen, setFormOpen] = useState(false)
  // Mount the modal's chunk only once it has been asked for.
  const [formWanted, setFormWanted] = useState(false)

  useEffect(() => {
    if (window.location.hash === FORM_HASH) {
      setFormWanted(true)
      setFormOpen(true)
    }
  }, [])

  function openForm() {
    setFormWanted(true)
    setFormOpen(true)
  }

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

        <header className="pb-10 lg:pb-14">
          <h1 className="text-balance font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-foreground sm:text-[56px]">
            {c.pageTitle}
          </h1>
          <p className="mt-4 max-w-xl text-[15px] font-light leading-relaxed text-foreground/70">{c.pageIntro}</p>
          <Link
            href="/support"
            className="group mt-6 inline-flex min-h-[44px] items-center gap-2 text-[13px] text-foreground/85 underline decoration-white/25 underline-offset-[6px] transition-colors hover:text-foreground hover:decoration-white"
          >
            {c.helpCenter}
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={1.25} aria-hidden />
          </Link>
        </header>

        <section aria-labelledby="contact-title" className="border-t border-white/10 py-12 lg:py-16">
          <h2
            id="contact-title"
            className="mb-8 font-serif text-[28px] font-normal leading-tight tracking-tight text-foreground sm:text-[32px]"
          >
            {c.contactTitle}
          </h2>
          <ContactMethods c={c} replySpan={replySpan} onOpenForm={openForm} />
        </section>

        <NewsletterBlock c={c} />
      </main>
      <Footer />

      {formWanted && (
        <SupportRequestModal open={formOpen} onOpenChange={setFormOpen} c={c} replySpan={replySpan} />
      )}
    </>
  )
}
