/**
 * Three lines that fold into an X: the menu button in the header and the
 * close button in the menu (components/site-menu.tsx) both draw it, so the
 * one appears to turn into the other. Transform and opacity only, styled in
 * app/globals.css (.menu-icon). Decorative: the button carries the label.
 */
export function MenuIcon({ open }: { open: boolean }) {
  return (
    <span className="menu-icon" data-open={open} aria-hidden>
      <span />
      <span />
      <span />
    </span>
  )
}
