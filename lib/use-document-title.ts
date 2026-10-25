'use client'

import { useEffect } from 'react'

const SUFFIX = ' — LUXE VAULT'

/**
 * The tab title of a client page, in the language the page is shown in.
 *
 * The segment's layout gives the server HTML an English title (a client page
 * cannot export metadata): `fallback`, the same words in English. This puts
 * the page's own language in its place, with the root template's suffix.
 *
 * Next applies the layout's title after hydration (metadata is streamed), so
 * setting document.title once is undone a moment later. Watching the head
 * and replacing exactly the English fallback — never any other title — wins
 * that race without fighting the next page's title on navigation.
 */
export function useDocumentTitle(title: string, fallback: string) {
  useEffect(() => {
    const wanted = title + SUFFIX
    const english = fallback + SUFFIX
    const apply = () => {
      if (document.title !== wanted && (document.title === english || document.title === '')) document.title = wanted
    }
    document.title = wanted
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [title, fallback])
}
