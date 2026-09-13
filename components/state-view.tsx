'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * The shop's empty states, in one shape.
 *
 * Every list used to say "nothing here" its own way — a grey line in one
 * place, a centred icon in another, a dead end in most. This is the single
 * form: an icon, one plain sentence, an optional hint, and the next step as a
 * real button. No popups: the state takes the place of the content it stands
 * for, so it is where the reader is already looking.
 *
 * Errors keep their own component (LoadError) because they are a different
 * claim — "we could not check", not "there is nothing" — and always retry.
 */

export type StateAction = {
  label: string
  /** Renders a link when set; otherwise a button. Both may be set — e.g. close
   *  a drawer (onClick) and navigate (href). */
  href?: string
  onClick?: () => void
  icon?: LucideIcon
}

const ACTION_STYLES = {
  primary:
    'tap-safe inline-flex items-center justify-center gap-2 border border-gold/40 bg-gold/5 px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-gold transition-all duration-300 hover:bg-gold hover:text-gold-foreground disabled:cursor-not-allowed disabled:opacity-50',
  outline:
    'tap-safe inline-flex items-center justify-center gap-2 border border-border px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] text-foreground transition-colors duration-300 hover:border-gold/50 hover:text-gold',
  secondary:
    'tap-safe inline-flex items-center gap-1.5 px-2 py-2.5 text-[11px] uppercase tracking-[0.15em] text-muted-foreground/70 transition hover:text-foreground',
} as const

export function StateActionButton({
  action,
  variant = 'primary',
  className,
}: {
  action: StateAction
  variant?: keyof typeof ACTION_STYLES
  className?: string
}) {
  const Icon = action.icon
  const content = (
    <>
      {Icon && <Icon className="size-3.5" strokeWidth={1.5} aria-hidden />}
      {action.label}
    </>
  )
  const classes = cn(ACTION_STYLES[variant], className)
  if (action.href) {
    return (
      <Link href={action.href} onClick={action.onClick} className={classes}>
        {content}
      </Link>
    )
  }
  return (
    <button type="button" onClick={action.onClick} className={classes}>
      {content}
    </button>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  secondary,
  compact = false,
  role,
  className,
}: {
  icon?: LucideIcon
  /** One plain sentence: what is (not) here. */
  title: string
  /** Why, or what happens next — optional, one line. */
  hint?: string
  /** The obvious next step. */
  action?: StateAction
  /** A quieter second way out. */
  secondary?: StateAction
  /** Tighter spacing for drawers and in-page sections. */
  compact?: boolean
  /** 'alert' when the state replaces content the reader was waiting for. */
  role?: 'alert' | 'status'
  className?: string
}) {
  return (
    <div
      role={role}
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'py-8' : 'py-16',
        className,
      )}
    >
      {Icon && (
        <Icon
          aria-hidden
          className={cn('text-muted-foreground/30', compact ? 'size-6' : 'size-8')}
          strokeWidth={1.25}
        />
      )}
      <p className={cn('font-light text-foreground', compact ? 'text-[13px]' : 'text-sm')}>{title}</p>
      {hint && (
        <p className="max-w-xs text-[12px] font-light leading-relaxed text-muted-foreground/70">
          {hint}
        </p>
      )}
      {(action || secondary) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          {action && <StateActionButton action={action} />}
          {secondary && <StateActionButton action={secondary} variant="secondary" />}
        </div>
      )}
    </div>
  )
}
