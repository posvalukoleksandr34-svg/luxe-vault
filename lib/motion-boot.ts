/**
 * Runs in <head>, before first paint, so a visitor who chose "reduce
 * animations" never sees one frame of the hero's entrance. Must stay in step
 * with MOTION_STORAGE_KEY and applyMotionPreference() in lib/motion-preference.
 * Kept in its own module so the server layout can import it without pulling
 * React client hooks into the server graph.
 *
 * One string for both parts below: middleware.ts allows it on the strict-CSP
 * pages (checkout, admin) by its SHA-256, computed from this constant, so
 * whatever is added here stays allowed without touching the policy.
 */
const MOTION_PREFERENCE =
  "try{if(localStorage.getItem('lv.motion')==='reduce'||(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){document.documentElement.setAttribute('data-motion','reduce')}}catch(e){}"

/** sessionStorage key: the full-page navigation that should animate. */
export const DOC_TRANSITION_KEY = 'lv.vt-doc'

/**
 * Transitions across a FULL page load (lib/document-transition.ts): the cart
 * to the checkout, the checkout to its confirmation. Those pages are served
 * with their own Content-Security-Policy, so they are reached by a real
 * navigation, never the router, and the in-page transitions
 * (lib/page-transition.ts) cannot reach them. The browser's cross-document
 * View Transitions can — app/globals.css opts in with
 * `@view-transition { navigation: auto }` — and these two handlers keep that
 * to the navigations that asked for it:
 *
 *   pageswap   (the page being left) — no fresh note for exactly this
 *              destination: skip. Otherwise mark it a forward transition, so
 *              the header is photographed on its own and holds still.
 *   pagereveal (the page arriving, before its first frame) — the note is read
 *              and removed; without it, skip. With it, the same attributes an
 *              in-page transition sets: the new page opens from the button
 *              that was pressed (--vt-ox/--vt-oy) and its content settles in.
 *              data-vt-doc stays until the next navigation in this document
 *              (lib/page-transition.ts, components/page-transition.tsx).
 *
 * Every other full load — signing out, the admin, back/forward, a reload —
 * finds no note and is skipped, so it looks exactly as it did. Reduced motion
 * skips too (and the CSS guard stops any animation that slipped through).
 * Browsers without the API never fire these events: plain navigation.
 */
const DOC_TRANSITION =
  "(function(){var K='" + DOC_TRANSITION_KEY + "',R=document.documentElement;" +
  "function note(){try{var n=JSON.parse(sessionStorage.getItem(K)||'null');return n&&Date.now()-n.at<15000?n:null}catch(e){return null}}" +
  "function still(){return R.getAttribute('data-motion')==='reduce'}" +
  "addEventListener('pageswap',function(e){var v=e.viewTransition;if(!v)return;var n=note(),a=e.activation,u=a&&a.entry&&a.entry.url;" +
  "if(!n||still()||(u&&new URL(u).pathname!==n.path)){v.skipTransition();return}R.setAttribute('data-vt','forward')});" +
  "addEventListener('pagereveal',function(e){var n=note();try{sessionStorage.removeItem(K)}catch(x){}var v=e.viewTransition;if(!v)return;" +
  "if(!n||still()||location.pathname!==n.path){v.skipTransition();return}" +
  "R.setAttribute('data-vt','forward');R.setAttribute('data-vt-arrive','page');R.setAttribute('data-vt-doc','');" +
  "if(typeof n.ox==='number'){R.style.setProperty('--vt-ox',n.ox+'px');R.style.setProperty('--vt-oy',n.oy+'px')}" +
  "v.finished.finally(function(){R.removeAttribute('data-vt');R.removeAttribute('data-vt-arrive');R.style.removeProperty('--vt-ox');R.style.removeProperty('--vt-oy')})})})();"

export const MOTION_BOOT_SCRIPT = MOTION_PREFERENCE + DOC_TRANSITION
