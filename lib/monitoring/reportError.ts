/**
 * Crash reporting from the BROWSER.
 *
 * Client-safe by construction: it imports nothing from the server and holds no
 * credentials. It posts to /api/monitoring/report, and that route — which does
 * hold them — forwards to Telegram and any configured webhook.
 *
 * WHY NOT POST TO THE WEBHOOK DIRECTLY, which would be one hop fewer: the URL
 * would have to be a NEXT_PUBLIC_ variable, and a webhook URL in the client
 * bundle is an open pipe into the operators' chat for anyone who opens
 * devtools. The extra hop is the whole security model, and it is also where
 * the rate limit lives.
 *
 * Server code does NOT use this. It calls reportServerError in
 * lib/monitoring/alert.ts directly — same report, no HTTP round trip to the
 * app's own API, and no dependency on the app being able to serve requests at
 * the moment it is failing.
 */

export type ClientErrorReport = {
  /** Where it happened, in words: "UI crash", "Root layout crash". */
  context: string
  message: string
  stack?: string
  /** Next's error digest, which ties this to the server log line. */
  digest?: string
}

/** Matches the route's own cap. Trimmed here too so a runaway stack is not
 *  uploaded only to be discarded. */
const MESSAGE_MAX = 500
const STACK_MAX = 2000

/**
 * Reports a crash, and never gets in the way of one.
 *
 * FAIL-SAFE, DELIBERATELY TOTAL. This is called from an error boundary — the
 * code that runs when the page has already broken. If reporting threw, or
 * rejected, or hung, it would replace a rendered error screen with a blank
 * one, which is the worst possible outcome of a monitoring feature. So:
 *
 *   * the whole body is wrapped, including the synchronous JSON building
 *   * the promise is given its own .catch, so a network failure after this
 *     function returns cannot surface as an unhandled rejection
 *   * `keepalive` lets the request outlive the page, because a crash is very
 *     often followed by the visitor closing the tab
 *   * it returns void immediately and is never awaited by a boundary
 *
 * Nothing here reports a failure to report. The console line is the floor.
 */
export function reportError(report: ClientErrorReport): void {
  try {
    if (typeof window === 'undefined') return

    const body = JSON.stringify({
      context: report.context.slice(0, 120),
      message: report.message.slice(0, MESSAGE_MAX),
      stack: report.stack?.slice(0, STACK_MAX),
      digest: report.digest?.slice(0, 120),
      url: window.location.href,
      timestamp: new Date().toISOString(),
    })

    void fetch('/api/monitoring/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Deliberately silent. The page is already showing the visitor an
      // error; a second one about the reporter helps nobody.
    })
  } catch {
    // Same reasoning: a monitoring call must never be the reason a crash
    // screen fails to render.
  }
}
