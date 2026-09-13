'use client'

import { ArrowLeft, LogIn, User } from 'lucide-react'
import { useStore } from '@/lib/store'

/**
 * "How would you like to check out?" — the step between the basket and the
 * checkout form for a visitor who is not signed in.
 *
 * An account is offered, never demanded: a sign-in wall at the moment of
 * paying is where baskets are abandoned. Continuing as a guest is the first,
 * filled button for that reason. Rendered in two places from this one
 * component — the cart drawer, and /checkout for anyone who lands there
 * directly — so the two can never offer different things.
 */
export function GuestCheckoutChoice({
  onGuest,
  onSignIn,
  onBack,
}: {
  onGuest: () => void
  onSignIn: () => void
  /** Back to the basket. Omitted where there is nothing to go back to. */
  onBack?: () => void
}) {
  const { t } = useStore()

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7 px-6 py-10 text-center">
      <div className="space-y-2.5">
        <h3 className="font-serif text-2xl font-bold tracking-tight text-foreground">
          {t('checkout.howTitle')}
        </h3>
        <p className="mx-auto max-w-sm text-[13px] font-light leading-relaxed text-muted-foreground">
          {t('checkout.howBody')}
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2.5">
        <button
          type="button"
          onClick={onGuest}
          className="flex w-full items-center justify-center gap-2.5 border border-gold bg-gold px-5 py-3.5 text-[12px] uppercase tracking-[0.15em] text-gold-foreground transition-opacity duration-300 hover:opacity-90"
        >
          <User className="size-4 shrink-0" strokeWidth={1.5} />
          {t('checkout.continueAsGuest')}
        </button>
        <button
          type="button"
          onClick={onSignIn}
          className="flex w-full items-center justify-center gap-2.5 border border-gold/40 bg-gold/5 px-5 py-3.5 text-[12px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground"
        >
          <LogIn className="size-4 shrink-0" strokeWidth={1.5} />
          {t('checkout.signInOrRegister')}
        </button>
      </div>

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="tap-safe flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t('checkout.backToCart')}
        </button>
      )}
    </div>
  )
}
