// The contact system's field treatment, shared by the request form and the
// newsletter block: square, a 1px white/10 hairline that brightens on hover
// and focus, monochrome text. No gold here — the page is deliberately plain.

export const FIELD =
  'w-full rounded-none border border-white/10 bg-transparent px-4 py-3 text-[14px] font-light text-foreground outline-none transition-colors duration-200 placeholder:text-foreground/35 hover:border-white/20 focus:border-white/50 focus-visible:outline-none aria-[invalid=true]:border-destructive/70'

export const LABEL = 't-label mb-2 block text-foreground/60'

export const ERROR_TEXT = 'mt-2 text-[12px] font-light text-destructive'

/** The one solid button: light on the dark ground, the highest contrast on
 *  the page. */
export const PRIMARY_BUTTON =
  't-cta inline-flex min-h-[48px] items-center justify-center gap-2 bg-foreground px-8 text-background transition-colors duration-200 hover:bg-foreground/85 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-60'
