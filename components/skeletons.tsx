import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Skeletons shaped like the things they stand in for.
 *
 * Each one mirrors the real component's box model closely enough that nothing
 * moves when the content arrives. That is the entire justification for a
 * skeleton over a spinner — if the shape is wrong, the page still jumps and
 * the extra machinery has bought nothing.
 *
 * Every list is wrapped in a region marked `aria-busy`, so a screen reader is
 * told the area is loading rather than being read a wall of empty divs.
 */

function Region({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  )
}

/** One order card: id + status row, two item lines, a total. */
export function OrderListSkeleton({ rows = 2, label }: { rows?: number; label: string }) {
  return (
    <Region label={label} className="space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border border-border/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Skeleton className="size-12 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/40 pt-3">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </Region>
  )
}

/** One review: avatar-less name line, stars, two lines of body. */
export function ReviewListSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <Region label={label} className="space-y-6">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-b border-border/40 pb-6 last:border-0">
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="mt-3 space-y-2">
            <Skeleton className="h-2.5 w-full" />
            {/* Short last line, because real paragraphs end mid-measure and a
                stack of full-width bars reads as a table. */}
            <Skeleton className="h-2.5 w-4/5" />
          </div>
        </div>
      ))}
    </Region>
  )
}

/** One saved address: label line plus two lines of street/city. */
export function AddressListSkeleton({ rows = 2, label }: { rows?: number; label: string }) {
  return (
    <Region label={label} className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border border-border/50 p-4">
          <Skeleton className="h-3 w-24" />
          <div className="mt-3 space-y-2">
            <Skeleton className="h-2.5 w-3/4" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </Region>
  )
}

/**
 * The order tracker on /order/[id]: a title, the status rail, and a panel.
 * Wider spacing than the list skeletons because that page is a single record
 * rather than a stack of them.
 */
export function OrderDetailSkeleton({ label }: { label: string }) {
  return (
    <Region label={label} className={cn('space-y-8')}>
      <div className="space-y-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="flex items-center gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-2">
            <Skeleton className="size-9" />
            <Skeleton className="h-2.5 w-full max-w-[70px]" />
          </div>
        ))}
      </div>
      <div className="space-y-3 border border-border/50 p-5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-2.5 w-2/3" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
    </Region>
  )
}
