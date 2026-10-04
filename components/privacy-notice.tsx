'use client'

import { Link } from '@/components/locale-link'
import type { UIKey } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The line under a form that collects personal data: what this form's data is
 * used for, and the Privacy Policy one tap away (GDPR arts. 12–13, nFADP
 * art. 19 — information at the point of collection). Each form passes its own
 * purpose; `withTerms` adds the Terms of Use where the action accepts them
 * (creating an account).
 */
export function PrivacyNotice({
  purpose,
  withTerms = false,
  className,
}: {
  purpose: UIKey
  withTerms?: boolean
  className?: string
}) {
  const { t } = useStore()
  const link = 'text-foreground/80 underline underline-offset-2 hover:text-foreground'
  return (
    <p className={cn('text-[11px] font-light leading-relaxed text-muted-foreground', className)}>
      {t(purpose)}{' '}
      {withTerms && (
        <>
          {t('privacy.termsPrefix')}{' '}
          <Link href="/legal/terms" target="_blank" className={link}>
            {t('footer.terms')}
          </Link>
          .{' '}
        </>
      )}
      <Link href="/legal/privacy" target="_blank" className={link}>
        {t('footer.privacy')}
      </Link>
    </p>
  )
}
