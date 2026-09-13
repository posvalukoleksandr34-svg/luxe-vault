'use client'

import { Check, Copy, MessageCircle, Send, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { copyText, telegramShareUrl, whatsappShareUrl, xShareUrl } from '@/lib/share'
import { useStore } from '@/lib/store'

/**
 * The desktop half of Smart Share.
 *
 * On a phone the OS sheet already offers every app the visitor has, so this
 * never opens there (see canShareNatively). On a laptop there is no such
 * sheet worth using, so the capsule gets a proper one: the link itself,
 * selectable and copyable in one press, and the three networks these
 * customers actually send links through.
 *
 * Links, not SDKs. No Telegram widget, no WhatsApp script, no X embed — each
 * button is an https intent URL, so nothing third-party loads on the page and
 * nothing tracks the visitor for opening it.
 */
export function ShareDialog({
  url,
  open,
  onOpenChange,
}: {
  url: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, pushToast } = useStore()
  const [copied, setCopied] = useState(false)

  // The confirmation is a state on the button, not a toast: the modal is
  // still open and covering where a toast would appear.
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  useEffect(() => {
    if (!open) setCopied(false)
  }, [open])

  async function copy() {
    if (await copyText(url)) {
      setCopied(true)
      return
    }
    // Refused (insecure origin, browser policy). The field below still holds
    // the link, so say so rather than failing silently.
    pushToast({ title: t('share.copyManually'), variant: 'default' })
  }

  const text = t('share.message')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-gold/20 bg-popover">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl font-bold tracking-tight">
            <Share2 className="size-4 text-gold" strokeWidth={1.5} />
            {t('share.title')}
          </DialogTitle>
          <DialogDescription className="text-[13px] font-light leading-relaxed">
            {t('share.lead')}
          </DialogDescription>
        </DialogHeader>

        {/* The link itself, first. Read-only rather than disabled: it can be
            selected, dragged and copied by hand, which is the fallback for
            every browser that refuses the clipboard API. */}
        <div className="flex items-stretch gap-2">
          <input
            readOnly
            value={url}
            aria-label={t('share.link')}
            onFocus={(e) => e.currentTarget.select()}
            className="h-11 min-w-0 flex-1 border border-border bg-background px-3.5 text-base leading-normal text-muted-foreground outline-none transition focus:border-gold/60 md:h-10 md:px-3 md:text-[13px]"
          />
          <button
            type="button"
            onClick={() => void copy()}
            className="flex h-11 shrink-0 items-center gap-2 border border-gold/40 bg-gold/5 px-4 text-[11px] uppercase tracking-[0.12em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground md:h-10"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? t('share.copied') : t('share.copy')}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Network href={telegramShareUrl(url, text)} label="Telegram">
            <Send className="size-4" strokeWidth={1.5} />
          </Network>
          <Network href={whatsappShareUrl(url, text)} label="WhatsApp">
            <MessageCircle className="size-4" strokeWidth={1.5} />
          </Network>
          <Network href={xShareUrl(url, text)} label="X">
            <XMark />
          </Network>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Network({
  href,
  label,
  children,
}: {
  href: string
  label: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      // noreferrer as well as noopener: the network does not need to be told
      // which capsule page the link was sent from.
      rel="noopener noreferrer"
      className="flex min-h-[64px] flex-col items-center justify-center gap-1.5 border border-border/60 text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-all duration-300 hover:border-gold/50 hover:text-gold"
    >
      {children}
      {label}
    </a>
  )
}

/** X's mark, inlined — lucide's Twitter bird is the old brand, and one glyph
 *  is not worth a network request. */
function XMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden focusable="false">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}
