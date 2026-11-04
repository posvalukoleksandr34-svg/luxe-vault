'use client'

import { Component, type ReactNode } from 'react'
import { CHUNK_ERROR_CONTEXT, isChunkLoadError, reloadOnceForChunkError } from '@/lib/chunk-error'
import { reportError } from '@/lib/monitoring/reportError'

/**
 * Keeps a lazily loaded, self-contained part of the page — a drawer, the
 * chat, the cookie banner, decoration — from taking the whole page down when
 * it fails.
 *
 * Without it, a cart-drawer chunk that did not download (lib/chunk-error.ts)
 * reached the page's error boundary: the visitor lost the page they were on
 * and saw "the catalogue is unavailable". Now:
 *
 *  - a chunk that did not download, in a part the visitor ASKED for
 *    (`recover`: a drawer they opened): the page reloads once — the basket and
 *    session are kept in storage — and a second failure within the window
 *    leaves the part closed and is reported as a connection problem;
 *  - in a part nobody asked for (decoration, the cookie banner): it is left
 *    out, the page carries on, and it is reported as a connection problem;
 *  - any other error: the part is left out and the error is reported as a
 *    crash, as before, naming the part.
 */
export class LazyBoundary extends Component<
  { name: string; recover?: boolean; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    if (isChunkLoadError(error)) {
      if (this.props.recover && reloadOnceForChunkError()) return
      reportError({ context: `${CHUNK_ERROR_CONTEXT} · ${this.props.name}`, message: error.message, stack: error.stack })
      return
    }
    reportError({ context: `UI crash · ${this.props.name}`, message: error.message, stack: error.stack })
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
