'use client'

import { ArrowRight, Mail, Phone, Send } from 'lucide-react'
import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_HOURS, TELEGRAM_ADMIN } from '@/lib/data'
import { fillCopy, type ContactCopy } from '@/lib/contact-copy'
import { cn } from '@/lib/utils'

const CARD =
  'group relative flex h-full flex-col border border-white/10 bg-transparent p-6 transition-colors duration-200 hover:border-white/25 focus-within:border-white/40 sm:p-8'

/**
 * "Свяжитесь с нами": two equal outlined cards.
 *
 * The email card as a whole opens the request form — a full-card button sits
 * under the content — while the address itself stays a real mailto link
 * above it, so both work and neither is nested inside the other.
 *
 * The second card is the phone line when one is configured
 * (NEXT_PUBLIC_SUPPORT_PHONE), and Telegram otherwise: the card only offers a
 * way to reach us that someone actually answers.
 */
export function ContactMethods({
  c,
  replySpan,
  onOpenForm,
}: {
  c: ContactCopy
  replySpan: string
  onOpenForm: () => void
}) {
  const telHref = `tel:${SUPPORT_PHONE.replace(/[^\d+]/g, '')}`

  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
      <div className={CARD}>
        <button
          type="button"
          onClick={onOpenForm}
          aria-label={c.emailOpenForm}
          className="absolute inset-0 z-0 hover:bg-white/[0.015] focus-visible:outline-none"
        />
        <div className="pointer-events-none relative flex items-start justify-between">
          <Mail className="size-5 text-foreground/85" strokeWidth={1.25} aria-hidden />
          <ArrowRight
            className="size-4 text-foreground/40 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-foreground/80"
            strokeWidth={1.25}
            aria-hidden
          />
        </div>
        <p className="t-label pointer-events-none relative mt-8 text-foreground/55">{c.emailLabel}</p>
        <p className="pointer-events-none relative mt-2 max-w-xs text-[14px] font-light leading-relaxed text-foreground/85">
          {c.emailBody}
        </p>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="relative z-10 mt-auto self-start pt-6 text-[14px] text-foreground underline decoration-white/25 underline-offset-[6px] transition-colors hover:decoration-white"
        >
          {SUPPORT_EMAIL}
        </a>
      </div>

      {SUPPORT_PHONE ? (
        <div className={CARD}>
          <Phone className="size-5 text-foreground/85" strokeWidth={1.25} aria-hidden />
          <p className="t-label mt-8 text-foreground/55">{c.phoneLabel}</p>
          <p className="mt-2 max-w-xs text-[14px] font-light leading-relaxed text-foreground/85">{c.phoneBody}</p>
          {SUPPORT_PHONE_HOURS && (
            <p className="t-meta mt-1 text-foreground/55">{SUPPORT_PHONE_HOURS}</p>
          )}
          <a
            href={telHref}
            className={cn(
              'mt-auto self-start pt-6 text-[14px] tabular-nums text-foreground underline decoration-white/25 underline-offset-[6px] transition-colors hover:decoration-white',
              // The whole card dials.
              "after:absolute after:inset-0 after:content-['']",
            )}
          >
            {SUPPORT_PHONE}
          </a>
        </div>
      ) : (
        <div className={CARD}>
          <Send className="size-5 text-foreground/85" strokeWidth={1.25} aria-hidden />
          <p className="t-label mt-8 text-foreground/55">{c.telegramLabel}</p>
          <p className="mt-2 max-w-xs text-[14px] font-light leading-relaxed text-foreground/85">
            {fillCopy(c.telegramBody, { span: replySpan })}
          </p>
          <a
            href={`https://t.me/${TELEGRAM_ADMIN.replace('@', '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-auto self-start pt-6 text-[14px] text-foreground underline decoration-white/25 underline-offset-[6px] transition-colors hover:decoration-white after:absolute after:inset-0 after:content-['']"
          >
            {TELEGRAM_ADMIN}
          </a>
        </div>
      )}
    </div>
  )
}
