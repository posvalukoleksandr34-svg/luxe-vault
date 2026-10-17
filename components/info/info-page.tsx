'use client'

import { ArrowRight } from 'lucide-react'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Link } from '@/components/locale-link'
import { cn } from '@/lib/utils'

/**
 * The frame shared by the customer-care pages (About, Shipping, FAQ): the
 * site header and footer, a breadcrumb, and one consistent heading block, so
 * the pages read as one set rather than four designs.
 */
export function InfoPage({
  path,
  eyebrow,
  title,
  lead,
  children,
}: {
  path: string
  eyebrow: string
  title: string
  lead: string
  children: React.ReactNode
}) {
  return (
    <>
      <Header />
      <main id="main" className="mx-auto w-full max-w-[880px] px-4 py-10 sm:px-6 lg:py-14">
        <Breadcrumbs
          trail={[
            { name: 'Luxe Vault', url: '/' },
            { name: title, url: path },
          ]}
        />
        <header className="border-b border-border pb-10">
          <p className="t-eyebrow text-gold">{eyebrow}</p>
          <h1 className="mt-4 text-balance font-serif text-[36px] font-normal leading-[1.08] tracking-tight text-foreground sm:text-[48px]">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] font-light leading-relaxed text-foreground/75">{lead}</p>
        </header>
        {children}
      </main>
      <Footer />
    </>
  )
}

/** A titled block of prose. `id` makes it linkable (/shipping#customs). */
export function InfoSection({
  id,
  title,
  children,
  className,
}: {
  id?: string
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('scroll-mt-24 border-b border-border/60 py-9', className)}>
      <h2 className="font-serif text-[24px] font-normal leading-tight tracking-tight text-foreground sm:text-[28px]">
        {title}
      </h2>
      <div className="mt-4 max-w-2xl space-y-3 text-[15px] font-light leading-relaxed text-foreground/80">
        {children}
      </div>
    </section>
  )
}

/** A short closing block: a question, a sentence, one or two actions. */
export function InfoCallout({
  title,
  body,
  primary,
  secondary,
}: {
  title: string
  body: string
  primary: { href: string; label: string }
  secondary?: { href: string; label: string }
}) {
  return (
    <section className="mt-12 rounded-xl border border-border bg-card/40 p-6 sm:p-8">
      <h2 className="font-serif text-[24px] font-normal leading-tight tracking-tight text-foreground">{title}</h2>
      <p className="mt-3 max-w-xl text-[15px] font-light leading-relaxed text-foreground/75">{body}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link href={primary.href} className="btn-primary-lv">
          {primary.label}
        </Link>
        {secondary && (
          <Link
            href={secondary.href}
            className="group inline-flex min-h-[44px] items-center gap-2 text-[13px] text-foreground/85 underline decoration-foreground/30 underline-offset-[6px] transition-colors hover:text-foreground hover:decoration-gold"
          >
            {secondary.label}
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={1.25} aria-hidden />
          </Link>
        )}
      </div>
    </section>
  )
}
