'use client'

import { FaqAccordion, useFaqVars } from '@/components/info/faq-accordion'
import { InfoCallout, InfoPage } from '@/components/info/info-page'
import { FAQ_PAGE, FAQ_PAGE_TOPICS } from '@/lib/content/faq-page'
import { fill } from '@/lib/support/copy'
import { FAQ } from '@/lib/support/faq'
import { useStore } from '@/lib/store'

export function FaqPage() {
  const { locale } = useStore()
  const c = FAQ_PAGE[locale] ?? FAQ_PAGE.en
  const vars = useFaqVars()

  return (
    <InfoPage path="/faq" eyebrow={c.eyebrow} title={c.title} lead={c.lead}>
      {/* Jump links: seven groups is a long page on a phone. */}
      <nav aria-label={c.title} className="mt-8 flex flex-wrap gap-2">
        {FAQ_PAGE_TOPICS.map((topic) => (
          <a
            key={topic}
            href={`#${topic}`}
            className="inline-flex min-h-[40px] items-center rounded-full border border-border px-4 text-[12px] text-foreground/80 transition-colors hover:border-gold/60 hover:text-foreground"
          >
            {c.groups[topic]}
          </a>
        ))}
      </nav>

      {FAQ_PAGE_TOPICS.map((topic) => {
        const entries = FAQ.filter((e) => e.topic === topic)
        if (entries.length === 0) return null
        return (
          <section key={topic} id={topic} aria-labelledby={`faq-${topic}`} className="scroll-mt-24 pt-12">
            <h2 id={`faq-${topic}`} className="mb-3 font-serif text-[24px] font-normal tracking-tight text-foreground sm:text-[28px]">
              {c.groups[topic]}
            </h2>
            <FaqAccordion entries={entries} />
          </section>
        )
      })}

      <InfoCallout
        title={c.stillTitle}
        body={fill(c.stillBody, vars)}
        primary={{ href: '/contact', label: c.contactCta }}
        secondary={{ href: '/support', label: c.helpCta }}
      />
    </InfoPage>
  )
}
