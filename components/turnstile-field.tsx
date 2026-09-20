'use client'

import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { TURNSTILE_SITE_KEY, isTurnstileEnabled } from '@/lib/turnstile'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The Cloudflare Turnstile challenge, as used above every auth submit button.
 *
 * Renders NOTHING when no site key is configured, so a shop without keys keeps
 * working exactly as before — `useTurnstileGate` below returns "satisfied" in
 * that case, and the submit button is never held hostage to a widget that is
 * not there.
 *
 * A token is single use and expires (Cloudflare gives it ~5 minutes), which is
 * why this exposes `reset()`: the form calls it after every attempt, so a
 * second try always carries a fresh token rather than replaying a spent one
 * that the server would reject as "timeout-or-duplicate".
 *
 * Theme is pinned to `dark` and the widget's own flexible width is used, so it
 * sits inside the drawer's column rather than forcing a 300px box.
 */

export type TurnstileFieldHandle = {
  /** Discards the current token and asks Cloudflare for a new challenge. */
  reset: () => void
}

type Props = {
  /** Called with a token when the challenge passes, and with null whenever the
   *  token stops being usable (error, expiry, reset). */
  onToken: (token: string | null) => void
  /** Labels the challenge in Cloudflare's analytics, e.g. "login". */
  action?: string
  className?: string
}

export const TurnstileField = forwardRef<TurnstileFieldHandle, Props>(function TurnstileField(
  { onToken, action, className },
  ref,
) {
  const { t, locale } = useStore()
  const widget = useRef<TurnstileInstance | null>(null)
  const [failed, setFailed] = useState(false)

  useImperativeHandle(ref, () => ({
    reset: () => {
      setFailed(false)
      onToken(null)
      widget.current?.reset()
    },
  }))

  if (!isTurnstileEnabled()) return null

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <Turnstile
        ref={widget}
        siteKey={TURNSTILE_SITE_KEY}
        options={{
          theme: 'dark',
          // Matches the drawer's own compact rhythm; the widget stretches to
          // the column width rather than sitting in a fixed 300px box.
          size: 'flexible',
          action,
          // Cloudflare renders its own copy; give it the visitor's language.
          language: locale,
          appearance: 'always',
        }}
        onSuccess={(token) => {
          setFailed(false)
          onToken(token)
        }}
        onError={() => {
          setFailed(true)
          onToken(null)
        }}
        // A token that expires while the form is still open is no longer
        // valid; clearing it puts the submit button back to "waiting".
        onExpire={() => onToken(null)}
        onAbort={() => onToken(null)}
      />
      {failed && (
        <p role="alert" className="text-[11px] font-light text-destructive">
          {t('turnstile.failed')}
        </p>
      )}
    </div>
  )
})
