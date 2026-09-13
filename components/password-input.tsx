'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Password field with a show/hide toggle.
 *
 * Notes on the details that matter here:
 *  - The toggle is a `type="button"`. Without that it defaults to `submit`
 *    inside a <form> and revealing the password would submit it.
 *  - Visibility resets per instance and is never persisted; a password left
 *    visible after a reload is a shoulder-surfing hazard.
 *  - `aria-pressed` + a real label make the state audible to screen readers,
 *    which otherwise hear only "button".
 *  - Right padding is reserved so a long password never runs under the icon.
 *  - Pressing the toggle never takes focus away from the field, and the caret
 *    stays where it was — see below.
 */
export function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
  required,
  minLength,
  placeholder,
  className,
  inputClassName,
  labelClassName,
  error,
  showLabel = 'Показать пароль',
  hideLabel = 'Скрыть пароль',
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  autoFocus?: boolean
  required?: boolean
  minLength?: number
  placeholder?: string
  className?: string
  /** Lets each call site keep its own field styling (the admin console and the
   *  storefront do not share a look). */
  inputClassName?: string
  labelClassName?: string
  error?: boolean
  /** Localized accessible labels for the toggle. Default to Russian because
   *  the admin console is Russian-only; the storefront passes translations. */
  showLabel?: string
  hideLabel?: string
}) {
  const [visible, setVisible] = useState(false)
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  /** Where the caret was when the toggle was pressed, and until when a reset
   *  of it counts as the browser's doing rather than the customer's. */
  const caret = useRef<{ pos: number; until: number } | null>(null)

  /**
   * Keeps the caret where it was across the password <-> text swap.
   *
   * Setting it once after the swap is not enough. Measured with a real tap in
   * touch emulation: this effect put the caret back at 12, and 46 ms LATER the
   * browser fired its own selectionchange and moved it to 0 — the swap resets
   * the selection asynchronously, a frame or two after React is done. So after
   * restoring, it watches for exactly that and puts the caret back once more.
   *
   * Only a snap to position 0, and only for 300 ms after the press: a
   * customer who deliberately taps somewhere else in the field is never
   * overridden.
   */
  useEffect(() => {
    const input = inputRef.current
    const want = caret.current
    if (!input || !want || document.activeElement !== input) return

    const restore = () => {
      try {
        input.setSelectionRange(want.pos, want.pos)
      } catch {
        // Selection APIs refused for this input type; leave the caret be.
      }
    }
    restore()

    function stop(): void {
      document.removeEventListener('selectionchange', onSelectionChange)
    }
    function onSelectionChange(): void {
      if (performance.now() > want!.until) {
        stop()
        return
      }
      if (document.activeElement === input && input!.selectionStart === 0 && want!.pos !== 0) {
        restore()
        stop()
      }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    const timer = setTimeout(stop, 300)
    return () => {
      stop()
      clearTimeout(timer)
    }
  }, [visible])

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={id}
          className={cn(
            'mb-1.5 block text-xs font-medium uppercase tracking-wider text-foreground',
            labelClassName,
          )}
        >
          {label}
        </label>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required={required}
          minLength={minLength}
          placeholder={placeholder}
          className={cn(
            // 44px tall and 16px text on a phone (iOS zooms the page for
            // anything smaller and never zooms back), stepping down to the
            // compact desktop field at md. pr-11 keeps the text clear of the
            // reveal button at both sizes.
            'h-11 w-full rounded-lg border bg-background px-3.5 py-2.5 pr-11 text-base leading-normal text-foreground outline-none transition focus:border-gold md:h-10 md:px-3 md:text-sm',
            error ? 'border-destructive' : 'border-border',
            inputClassName,
          )}
        />
        <button
          type="button"
          // The toggle must not take focus from the field. tabIndex={-1} alone
          // does NOT do that — it only removes the button from the Tab order;
          // a tap or click still focuses a tabindex=-1 element. Measured with
          // touch emulation: tapping the eye fired focusout on the field and
          // focusin on the button, and on a phone losing focus closes the
          // keyboard — so every "let me check what I typed" meant tapping
          // back into the field to carry on.
          //
          // Two layers, because platforms disagree about where focus moves:
          //  - preventDefault on the press stops the focus shift wherever the
          //    browser honours it (desktop, Android);
          //  - the click then puts focus back in the field explicitly. That
          //    runs inside the tap, which is the one moment iOS lets focus()
          //    keep the keyboard open.
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const input = inputRef.current
            // Only a field that has focus has a caret worth keeping; tapping
            // the eye on an empty, unfocused field just reveals it.
            caret.current =
              input && document.activeElement === input
                ? {
                    pos: input.selectionStart ?? input.value.length,
                    until: performance.now() + 300,
                  }
                : null
            setVisible((v) => !v)
            input?.focus({ preventScroll: true })
          }}
          tabIndex={-1}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" strokeWidth={1.5} />
          ) : (
            <Eye className="h-4 w-4" strokeWidth={1.5} />
          )}
        </button>
      </div>
    </div>
  )
}
