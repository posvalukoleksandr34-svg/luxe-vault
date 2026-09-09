import { cn } from '@/lib/utils';

/**
 * A loading placeholder shaped like the thing it is standing in for.
 *
 * Replaces `animate-pulse rounded-md bg-muted`, which had two problems here:
 * the radius was dead (globals.css collapses every corner to 0) and a pulsing
 * grey block on a near-black ground reads as a broken image rather than as
 * loading. This is a warm charcoal bar with a slow gold sheen crossing it —
 * the same light vocabulary the rest of the site uses.
 *
 * A skeleton earns its place over a spinner only when it MATCHES THE LAYOUT
 * that replaces it. A centred spinner tells you nothing is here yet and then
 * shoves the page down when content arrives; a skeleton of the right shape
 * reserves the space, so nothing moves. Where the eventual shape is unknown,
 * a spinner is still the honest choice.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // Not aria-hidden: a screen reader gets "loading" from the region's own
      // aria-busy/aria-live, and hiding these would leave that region empty.
      aria-hidden
      className={cn('skeleton', className)}
      {...props}
    />
  );
}

export { Skeleton };
