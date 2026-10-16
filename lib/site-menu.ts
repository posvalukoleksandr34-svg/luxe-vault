import { useSyncExternalStore } from 'react'

/**
 * Open or closed: the site menu (components/site-menu.tsx).
 *
 * The button that opens it is in the header, which every page renders for
 * itself and so remounts on every navigation; the panel is mounted once, in
 * the root layout (components/global-panels.tsx). That split is what lets a
 * chosen link slide the panel out while the next page renders, instead of
 * the panel vanishing with the page that opened it. A module-level value
 * joins the two without going through the store, whose every change
 * re-renders the whole storefront.
 */
let open = false
const listeners = new Set<() => void>()

export function setSiteMenuOpen(next: boolean): void {
  if (open === next) return
  open = next
  listeners.forEach((listener) => listener())
}

export const openSiteMenu = (): void => setSiteMenuOpen(true)
export const closeSiteMenu = (): void => setSiteMenuOpen(false)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSiteMenuOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
}
