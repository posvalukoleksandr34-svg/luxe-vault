'use client'

import { Bookmark } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useStore } from '@/lib/store'

/**
 * Shown when a visitor who is not signed in presses "Save look".
 *
 * An invitation, not a wall: it says what signing in gets them (the look,
 * its pieces and the stylist's note, on any device), offers both ways in, and
 * lets them decline. The look is not lost either way — LookActions keeps the
 * intent and saves it the moment a session appears, so "sign in" here really
 * does mean "sign in and it is saved", not "sign in and press Save again".
 */
export function SaveLookAuthDialog({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the tab the account drawer should open on. */
  onChoose: (mode: 'login' | 'register') => void
}) {
  const { t } = useStore()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-gold/25 bg-popover px-6 py-8 sm:px-8">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-gold/30 bg-gold/[0.06] glow-breathe">
          <Bookmark className="size-5 text-gold" strokeWidth={1.5} />
        </div>

        <DialogHeader className="items-center space-y-3 text-center sm:text-center">
          <DialogTitle className="font-serif text-2xl font-bold leading-tight tracking-tight text-foreground">
            {t('looks.authTitle')}
          </DialogTitle>
          <DialogDescription className="max-w-[34ch] text-[13px] font-light leading-relaxed text-muted-foreground">
            {t('looks.authBody')}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => onChoose('login')}
            className="w-full border border-gold bg-gold px-5 py-3.5 text-[12px] uppercase tracking-[0.18em] text-gold-foreground transition-opacity duration-300 hover:opacity-90"
          >
            {t('user.login')}
          </button>
          <button
            type="button"
            onClick={() => onChoose('register')}
            className="w-full border border-gold/40 bg-gold/5 px-5 py-3.5 text-[12px] uppercase tracking-[0.18em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
          >
            {t('looks.authRegister')}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="tap-safe mx-auto mt-1 text-[11px] uppercase tracking-[0.15em] text-muted-foreground/60 transition hover:text-foreground"
          >
            {t('looks.authLater')}
          </button>
        </div>

        <p className="text-center text-[11px] font-light text-muted-foreground/50">
          {t('looks.authNote')}
        </p>
      </DialogContent>
    </Dialog>
  )
}
