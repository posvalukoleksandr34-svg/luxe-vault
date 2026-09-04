'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Wraps its children in a slow, deliberate fade-and-rise entrance that fires
 * once the element scrolls into view. Used throughout the storefront for the
 * cinematic, editorial reveal treatment (sections, cards, headlines).
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.unobserve(el)
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{ transitionDelay: visible ? `${delay}ms` : '0ms' }}
      className={cn(
        'transition-all duration-[1100ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
        !visible && 'will-change-transform',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12',
        className,
      )}
    >
      {children}
    </div>
  )
}
