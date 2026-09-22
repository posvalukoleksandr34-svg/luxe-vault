'use client'

import * as Popover from '@radix-ui/react-popover'
import { ChevronRight, User, X } from 'lucide-react'
import { Link } from '@/components/locale-link'
import { useState } from 'react'
import { ACCOUNT_SECTIONS, accountHref } from '@/components/account/sections'
import { useStore } from '@/lib/store'

/**
 * The header's account control.
 *
 * Signed out, it opens the account drawer on sign-in, as it always has.
 * Signed in, it opens a small menu under the icon: the customer's name with a
 * close button, the account's sections, and one solid button to the account
 * page. Radix Popover supplies the focus handling, Escape and outside-click.
 *
 * Sign-out sits under the button as a quiet text action: the drawer that used
 * to hold it no longer opens from here, and leaving it out would remove the
 * only one-click way out of the account.
 */
export function AccountMenu() {
  const { currentUser, openAccount, logout, t } = useStore()
  const [open, setOpen] = useState(false)

  const triggerClass =
    'tap-safe relative flex size-8 items-center justify-center text-muted-foreground transition hover:text-foreground sm:size-9'

  if (!currentUser) {
    return (
      <button type="button" onClick={() => openAccount('orders')} className={triggerClass} aria-label={t('nav.profile')}>
        <User className="size-[18px]" />
      </button>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={triggerClass} aria-label={t('acct.menuLabel')}>
          <User className="size-[18px]" />
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-gold" aria-hidden />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={12}
          collisionPadding={8}
          aria-label={t('acct.menuLabel')}
          className="z-[60] w-[min(340px,calc(100vw-16px))] border border-white/10 bg-background shadow-2xl shadow-black/50 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2 pl-6 pr-2">
            <p className="min-w-0 truncate text-[15px] font-normal text-foreground">{currentUser.name}</p>
            <Popover.Close
              aria-label={t('acct.close')}
              className="flex size-11 shrink-0 items-center justify-center text-foreground/60 transition-colors hover:text-foreground"
            >
              <X className="size-4" strokeWidth={1.5} />
            </Popover.Close>
          </div>

          <nav aria-label={t('acct.sections')}>
            <ul className="py-2">
              {ACCOUNT_SECTIONS.filter((s) => s.inMenu).map((section) => (
                <li key={section.key}>
                  <Link
                    href={accountHref(section.key)}
                    onClick={() => setOpen(false)}
                    className="group flex min-h-[46px] items-center justify-between gap-3 px-6 text-[14px] font-light text-foreground/75 transition-colors hover:bg-white/[0.03] hover:text-foreground focus-visible:bg-white/[0.04] focus-visible:text-foreground"
                  >
                    {t(section.labelKey)}
                    <ChevronRight
                      className="size-3.5 shrink-0 text-foreground/0 transition-colors group-hover:text-foreground/50 group-focus-visible:text-foreground/50"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="border-t border-white/10 px-6 pb-4 pt-5">
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="t-cta flex min-h-[48px] w-full items-center justify-center bg-foreground text-background transition-colors hover:bg-foreground/85"
            >
              {t('acct.goToAccount')}
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                void logout()
              }}
              className="mt-2 flex min-h-[40px] w-full items-center justify-center text-[12px] font-light text-foreground/50 transition-colors hover:text-foreground"
            >
              {t('user.logout')}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
