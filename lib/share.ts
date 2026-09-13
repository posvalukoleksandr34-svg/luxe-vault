/**
 * Sharing a link, by whatever route the device actually has.
 *
 * On a phone that means the OS share sheet — Telegram, WhatsApp, Instagram,
 * Messages, AirDrop, whatever the visitor has installed — which no web page
 * can reproduce. On a desktop it means our own modal, because the browser
 * either has no sheet at all or has one nobody expects.
 */

export type ShareOutcome =
  /** Handed to the OS sheet and sent. */
  | 'shared'
  /** The sheet opened and the visitor closed it. Not a failure: do nothing. */
  | 'dismissed'
  /** No sheet on this device — show the modal instead. */
  | 'unsupported'
  /** There was a sheet and it refused. Show the modal instead. */
  | 'failed'

/**
 * Whether to go straight to the OS share sheet.
 *
 * `navigator.share` alone is not the test. Desktop Chrome and Edge on Windows
 * expose it too and open the Windows share panel, which is not what someone
 * sharing a capsule from a laptop expects — and it cannot offer WhatsApp Web
 * or a copyable link the way our own modal can. So: a share sheet AND a
 * touch device.
 */
export function canShareNatively(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}

/**
 * Opens the OS share sheet.
 *
 * Must be called from a user gesture. The capsule has to be saved first,
 * though, and after that await the gesture may have expired — which browsers
 * report as NotAllowedError. That is precisely why 'failed' is a distinct
 * outcome from 'dismissed': the caller falls back to the modal on the first
 * and stays quiet on the second.
 */
export async function shareNatively(data: ShareData): Promise<ShareOutcome> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return 'unsupported'
  }
  if (typeof navigator.canShare === 'function' && !navigator.canShare(data)) {
    return 'unsupported'
  }
  try {
    await navigator.share(data)
    return 'shared'
  } catch (error) {
    return (error as DOMException | undefined)?.name === 'AbortError' ? 'dismissed' : 'failed'
  }
}

/** Copies text, reporting whether it worked. The clipboard is refused on
 *  insecure origins and by some browser policies, so the caller always needs
 *  a plan for false. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// ------------------------------------------------------------------ networks

/**
 * Web intents for the three networks this shop's customers actually use.
 *
 * Plain https links, opened in a new tab: no SDK, no tracking pixel, no
 * third-party script on the page. Each one hands the network a URL and a line
 * of text and lets it compose the post.
 */
export function telegramShareUrl(url: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
}

export function whatsappShareUrl(url: string, text: string): string {
  // WhatsApp takes one text field, so the link is appended to it. wa.me opens
  // the app on a phone and WhatsApp Web on a desktop.
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
}

export function xShareUrl(url: string, text: string): string {
  // x.com/intent/post is the current endpoint; twitter.com/intent/tweet still
  // redirects to it, but pointing at the redirect target avoids the hop.
  return `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
}
