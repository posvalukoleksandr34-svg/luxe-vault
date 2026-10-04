'use client'

import { Instagram, LifeBuoy, Mail, Phone, Send } from 'lucide-react'
import { Link } from '@/components/locale-link'
import { openCookieSettings } from '@/lib/cookie-settings'
import { SoundToggle } from '@/components/sound-toggle'
import { MotionToggle } from '@/components/motion-toggle'
import { BUSINESS } from '@/config/business'
import { useStore } from '@/lib/store'
import { FooterNewsletter } from '@/components/newsletter/footer-newsletter'

/** Opens the support center drawer: help, the request form, and the
 *  customer's requests with our replies. */
function FooterSupportLink() {
  const { t, openSupport } = useStore()
  return (
    <button type="button" onClick={() => openSupport()} className={LINK}>
      <LifeBuoy className="size-3.5 shrink-0 text-gold" aria-hidden />
      {t('support.footerLink')}
    </button>
  )
}

const LINK =
  'tap-safe inline-flex min-h-[32px] items-center gap-2 text-left text-[13px] font-light text-muted-foreground transition hover:text-foreground'
const HEADING = 'mb-4 text-[10px] uppercase tracking-[0.2em] text-foreground'

/** TikTok has no lucide icon; a plain, recognisable glyph at the same weight. */
function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M14 3c.5 2.8 2.4 4.6 5 5" />
    </svg>
  )
}

/**
 * The footer: what a first-time customer scans to decide whether the shop is
 * real — who runs it, how to reach them, and every policy one click away.
 *
 * Only real destinations. The social column lists a profile only when its
 * URL is configured (config/business.ts); Telegram is the staffed support
 * channel and always present. The old "Shop" buttons scrolled to a #shop
 * section the homepage no longer has, so they did nothing; they are links to
 * the catalogue now.
 */
export function Footer() {
  const { t } = useStore()

  return (
    <footer className="border-t border-border bg-card/20">
      <div className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6 lg:px-10 lg:py-20">
        <FooterNewsletter />

        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4 lg:grid-cols-5">
          <div className="col-span-2 md:col-span-4 lg:col-span-1">
            <Link href="/" aria-label="LUXE VAULT — home" className="inline-flex items-baseline gap-0.5">
              <span className="font-serif text-lg font-bold tracking-[0.22em] text-foreground">LUXE</span>
              <span className="font-serif text-lg font-bold tracking-[0.22em] text-gold">VAULT</span>
            </Link>
            <p className="mt-4 max-w-xs text-[12px] font-light leading-relaxed text-muted-foreground">
              {t('footer.tagline')}
            </p>
            <p className="mt-3 text-[11px] font-light text-muted-foreground">{t('footer.basedIn')}</p>
          </div>

          <nav aria-labelledby="footer-shop">
            <h2 id="footer-shop" className={HEADING}>{t('footer.shop')}</h2>
            <ul className="space-y-1.5">
              <li><Link href="/catalog" className={LINK}>{t('footer.allProducts')}</Link></li>
              <li><Link href="/catalog?view=new" className={LINK}>{t('footer.new')}</Link></li>
              <li><Link href="/catalog?view=sale" className={LINK}>{t('footer.sale')}</Link></li>
              <li><Link href="/stylist" className={LINK}>{t('stylist.cta')}</Link></li>
              <li><Link href="/wishlist" className={LINK}>{t('wishlist.title')}</Link></li>
            </ul>
          </nav>

          <nav aria-labelledby="footer-care">
            <h2 id="footer-care" className={HEADING}>{t('footer.customerCare')}</h2>
            <ul className="space-y-1.5">
              <li><Link href="/contact" className={LINK}>{t('nav.contact')}</Link></li>
              <li><Link href="/shipping" className={LINK}>{t('footer.shipping')}</Link></li>
              <li><Link href="/legal/refunds" className={LINK}>{t('footer.returnsRefunds')}</Link></li>
              <li><Link href="/faq" className={LINK}>{t('footer.faq')}</Link></li>
              <li><Link href="/about" className={LINK}>{t('nav.about')}</Link></li>
              <li><FooterSupportLink /></li>
            </ul>
          </nav>

          <nav aria-labelledby="footer-legal">
            <h2 id="footer-legal" className={HEADING}>{t('footer.legalHeading')}</h2>
            <ul className="space-y-1.5">
              <li><Link href="/legal/terms" className={LINK}>{t('footer.termsShort')}</Link></li>
              <li><Link href="/legal/privacy" className={LINK}>{t('footer.privacy')}</Link></li>
              <li><Link href="/legal/cookies" className={LINK}>{t('footer.cookiePolicy')}</Link></li>
              <li><Link href="/legal/imprint" className={LINK}>{t('footer.imprint')}</Link></li>
              <li>
                {/* Consent must be withdrawable as easily as it was given:
                    a permanent entry point, not a one-off banner. */}
                <button type="button" onClick={openCookieSettings} className={LINK}>
                  {t('cookies.settings')}
                </button>
              </li>
            </ul>
          </nav>

          <div>
            <h2 className={HEADING}>{t('footer.contact')}</h2>
            <ul className="space-y-1.5">
              <li>
                <a href={`mailto:${BUSINESS.email}`} className={LINK}>
                  <Mail className="size-3.5 shrink-0 text-gold" aria-hidden />
                  <span>{BUSINESS.email.split('@')[0]}@<wbr />{BUSINESS.email.split('@')[1]}</span>
                </a>
              </li>
              {BUSINESS.phone && (
                <li>
                  <a href={`tel:${BUSINESS.phone.replace(/[^\d+]/g, '')}`} className={LINK}>
                    <Phone className="size-3.5 shrink-0 text-gold" aria-hidden />
                    {BUSINESS.phone}
                  </a>
                </li>
              )}
              <li>
                <a href={BUSINESS.telegramUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
                  <Send className="size-3.5 shrink-0 text-gold" aria-hidden />
                  Telegram {BUSINESS.telegram}
                </a>
              </li>
              {BUSINESS.social.instagram && (
                <li>
                  <a href={BUSINESS.social.instagram} target="_blank" rel="noopener noreferrer me" className={LINK}>
                    <Instagram className="size-3.5 shrink-0 text-gold" aria-hidden />
                    Instagram
                  </a>
                </li>
              )}
              {BUSINESS.social.tiktok && (
                <li>
                  <a href={BUSINESS.social.tiktok} target="_blank" rel="noopener noreferrer me" className={LINK}>
                    <TikTokIcon />
                    TikTok
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center gap-4 border-t border-border/40 pt-6 sm:flex-row sm:justify-between">
          <p className="text-[11px] font-light text-muted-foreground">
            © {new Date().getFullYear()} {BUSINESS.tradingName}
            {BUSINESS.legalName ? ` · ${BUSINESS.legalName}` : ''}
          </p>
          <div className="flex items-center gap-5">
            <SoundToggle />
            <MotionToggle />
          </div>
        </div>
      </div>
    </footer>
  )
}
