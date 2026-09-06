import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { LegalLangSwitch } from './_content/LegalLangSwitch'

/**
 * Shared shell for the legal documents.
 *
 * Deliberately server-rendered and free of the client store: these pages must
 * be readable, linkable and indexable without any JavaScript, and a regulator
 * or payment provider checking them should not need the app to boot.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
      {/* The site header is not rendered on these pages, so the language
          control has to live here — otherwise anyone arriving from a footer
          link or a shared URL cannot change it. */}
      <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground transition hover:text-gold"
        >
          <ArrowLeft className="size-3" />
          LUXE VAULT
        </Link>
        <LegalLangSwitch />
      </div>
      <article
        className="
          space-y-5 text-[14px] font-light leading-relaxed text-muted-foreground
          [&_h1]:mb-2 [&_h1]:font-serif [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:text-foreground
          [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground
          [&_a]:text-gold [&_a]:underline-offset-2 hover:[&_a]:underline
          [&_li]:mb-1.5 [&_strong]:font-medium [&_strong]:text-foreground
          [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5
          [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5
        "
      >
        {children}
      </article>
    </main>
  )
}
