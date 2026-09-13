/**
 * Runs in <head>, before first paint, so a visitor who chose "reduce
 * animations" never sees one frame of the hero's entrance. Must stay in step
 * with MOTION_STORAGE_KEY and applyMotionPreference() in lib/motion-preference.
 * Kept in its own module so the server layout can import it without pulling
 * React client hooks into the server graph.
 */
export const MOTION_BOOT_SCRIPT =
  "try{if(localStorage.getItem('lv.motion')==='reduce'||(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){document.documentElement.setAttribute('data-motion','reduce')}}catch(e){}"
