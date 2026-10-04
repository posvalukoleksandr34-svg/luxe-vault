// The contact system's field treatment, shared by the request form and the
// newsletter block: square, a 1px white/10 hairline that brightens on hover
// and focus, monochrome text. No gold here — the page is deliberately plain.

export const FIELD =
  'min-h-[48px] w-full rounded-xl border border-foreground/25 bg-card px-4 py-3 text-[14px] font-light text-foreground outline-none transition-colors duration-200 placeholder:text-foreground/45 hover:border-foreground/40 focus:border-gold focus:ring-4 focus:ring-gold/15 focus-visible:outline-none aria-[invalid=true]:border-destructive'

export const LABEL = 't-label mb-2 block text-foreground/75'

export const ERROR_TEXT = 'mt-2 text-[12px] font-light text-destructive'

/** The one solid button: light on the dark ground, the highest contrast on
 *  the page. */
export const PRIMARY_BUTTON =
  't-cta inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-foreground px-8 text-background transition-colors duration-200 hover:bg-foreground/85 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-60'
