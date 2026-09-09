'use client'

import { LifeBuoy, Mail, Send } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { openCookieSettings } from '@/components/cookie-consent'
import { SUPPORT_EMAIL, TELEGRAM_ADMIN } from '@/lib/data'
import { TOTAL_WINDOW } from '@/lib/fulfilment'
import { useStore } from '@/lib/store'

function scrollTo(id: string) {
  const el = document.getElementById(id)
  if (el) {
    const top = el.getBoundingClientRect().top + window.scrollY - 72
    window.scrollTo({ top, behavior: 'smooth' })
  }
}

/**
 * Each accordion item has a unique `value` ("delivery" / "returns" / "reviews").
 * Because the root Accordion below is `type="single" collapsible`, Radix
 * guarantees that clicking one trigger opens exactly that item's content and
 * closes any other open item — so "Доставка", "Возврат" and "Отзывы" never
 * appear open at the same time and clicking one never toggles another.
 */
export function Footer() {
  const { t, tf } = useStore()

  return (
    <footer className="border-t border-border bg-card/20">
      <div className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6 lg:px-10">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-1">
            <div className="flex items-baseline gap-0.5">
              <span className="font-serif text-lg font-bold tracking-[0.22em] text-foreground">
                LUXE
              </span>
              <span className="font-serif text-lg font-bold tracking-[0.22em] text-gold">
                VAULT
              </span>
            </div>
            <p className="mt-4 max-w-xs text-[12px] font-light leading-relaxed text-muted-foreground/60">
              {t('footer.tagline')}
            </p>
          </div>

          <div>
            <h3 className="mb-4 text-[10px] uppercase tracking-[0.2em] text-foreground">
              {t('footer.shop')}
            </h3>
            <ul className="space-y-2.5">
              <li>
                <button onClick={() => scrollTo('shop')} className="tap-safe text-[12px] font-light text-muted-foreground/60 transition hover:text-foreground">
                  {t('footer.new')}
                </button>
              </li>
              <li>
                <button onClick={() => scrollTo('collections')} className="tap-safe text-[12px] font-light text-muted-foreground/60 transition hover:text-foreground">
                  {t('nav.collections')}
                </button>
              </li>
              <li>
                <button onClick={() => scrollTo('shop')} className="tap-safe text-[12px] font-light text-muted-foreground/60 transition hover:text-foreground">
                  {t('footer.sale')}
                </button>
              </li>
            </ul>
          </div>

          {/* Help / FAQ accordion — each item opens strictly its own content */}
          <div>
            <h3 className="mb-4 text-[10px] uppercase tracking-[0.2em] text-foreground">
              {t('footer.help')}
            </h3>
            <Accordion type="single" collapsible className="-mt-1 w-full">
              <AccordionItem value="delivery" className="border-border/40">
                <AccordionTrigger className="py-2.5 text-[12px] font-light text-muted-foreground/80 hover:text-foreground hover:no-underline">
                  {t('footer.delivery')}
                </AccordionTrigger>
                <AccordionContent className="pb-3 text-[12px] font-light leading-relaxed text-muted-foreground/60">
                  {tf('help.delivery.content', TOTAL_WINDOW)}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="returns" className="border-border/40">
                <AccordionTrigger className="py-2.5 text-[12px] font-light text-muted-foreground/80 hover:text-foreground hover:no-underline">
                  {t('footer.returns')}
                </AccordionTrigger>
                <AccordionContent className="pb-3 text-[12px] font-light leading-relaxed text-muted-foreground/60">
                  {t('help.returns.content')}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="reviews" className="border-border/40 last:border-0">
                <AccordionTrigger className="py-2.5 text-[12px] font-light text-muted-foreground/80 hover:text-foreground hover:no-underline">
                  {t('footer.reviews')}
                </AccordionTrigger>
                <AccordionContent className="pb-3 text-[12px] font-light leading-relaxed text-muted-foreground/60">
                  {t('help.reviews.content')}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <div>
            <h3 className="mb-4 text-[10px] uppercase tracking-[0.2em] text-foreground">
              {t('footer.contact')}
            </h3>
            <ul className="space-y-2.5">
              <li>
                <a
                  href={`https://t.me/${TELEGRAM_ADMIN.replace('@', '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap-safe flex items-center gap-2 text-[12px] font-light text-muted-foreground/60 transition hover:text-gold"
                >
                  <Send className="size-3.5 shrink-0" />
                  {TELEGRAM_ADMIN}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="tap-safe flex items-center gap-2 text-[12px] font-light text-muted-foreground/60 transition hover:text-gold"
                >
                  <Mail className="size-3.5 shrink-0" />
                  {SUPPORT_EMAIL}
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="tap-safe flex items-center gap-2 text-[12px] font-light text-gold/80 transition hover:text-gold"
                >
                  <LifeBuoy className="size-3.5 shrink-0" />
                  {t('support.footerLink')}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 space-y-4 border-t border-border/40 pt-6 text-center">
          {/* Legal links belong in the footer of every page: payment providers
              and app stores check for them, and GDPR requires the privacy
              notice to be reachable from anywhere. */}
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <a href="/legal/terms" className="tap-safe text-[11px] font-light text-muted-foreground/50 transition hover:text-gold">
              {t('footer.terms')}
            </a>
            <a href="/legal/privacy" className="tap-safe text-[11px] font-light text-muted-foreground/50 transition hover:text-gold">
              {t('footer.privacy')}
            </a>
            <a href="/legal/refunds" className="tap-safe text-[11px] font-light text-muted-foreground/50 transition hover:text-gold">
              {t('footer.refunds')}
            </a>
            {/* Consent must be withdrawable as easily as it was given, which
                means a permanent entry point rather than a one-off banner. */}
            <button
              type="button"
              onClick={openCookieSettings}
              className="tap-safe text-[11px] font-light text-muted-foreground/50 transition hover:text-gold"
            >
              {t('cookies.settings')}
            </button>
          </nav>
          <p className="text-[11px] font-light text-muted-foreground/40">
            {t('footer.rights')}
          </p>
        </div>
      </div>
    </footer>
  )
}
