/**
 * Status tones for tags and badges.
 *
 * Hue used to carry a state — amber waiting, blue moving, green done, red
 * stopped, violet refunded. In black and white the label carries the state
 * and the tone only its weight, so no two read alike even in greyscale print
 * or to a colour-blind eye:
 *
 *   done     a solid black tag                (delivered, paid, active)
 *   active   a grey outline                   (waiting, in progress)
 *   stopped  a dashed black outline           (cancelled, failed, rejected)
 *   muted    a grey fill                      (refunded, settled, archived)
 *
 * Tailwind utilities rather than CSS classes, so `cn()` resolves them against
 * a call site's own `bg-background` instead of losing to it. The tag still
 * needs its own `border`.
 */
export const TONE = {
  done: 'border-foreground bg-foreground text-background',
  active: 'border-foreground/40 bg-background text-foreground',
  stopped: 'border-dashed border-foreground/70 bg-background text-foreground',
  muted: 'border-border bg-muted text-muted-foreground',
} as const

export type Tone = keyof typeof TONE
