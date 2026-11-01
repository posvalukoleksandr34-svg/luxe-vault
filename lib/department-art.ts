/**
 * Default artwork for the three departments: the homepage's department cards
 * (components/sections-grid.tsx) and each department page's header
 * (components/products/department-hero.tsx) show the same photograph, so the
 * card a visitor clicked is the picture that opens the page.
 *
 * Each URL is an Unsplash photograph chosen for the shop: dark, tailored,
 * editorial — mood, never a product (no item shown here is for sale).
 * `w=1400&q=80&auto=format` asks Unsplash's CDN for a card-sized,
 * modern-format file; the source files are 4000px. Unsplash is allowed by
 * both the CSP and next.config's remotePatterns.
 *
 * These are DEFAULTS. A cover set in the admin (Разделы → card image) wins
 * everywhere it is shown.
 */
export type DepartmentArt = { image: string; fallback: string }

export const DEPARTMENT_ART: Record<string, DepartmentArt> = {
  women: {
    image:
      'https://images.unsplash.com/photo-1759873911531-f6ea6a178378?w=1400&q=80&auto=format&fit=crop',
    fallback: 'radial-gradient(120% 90% at 20% 0%, #f3ece0 0%, #e4d8c4 75%)',
  },
  men: {
    image:
      'https://images.unsplash.com/photo-1764698072732-ea0230fc5d8e?w=1400&q=80&auto=format&fit=crop',
    fallback: 'radial-gradient(120% 90% at 80% 10%, #f1eadf 0%, #e1d5c1 75%)',
  },
  kids: {
    image:
      // `sat=-100` (an imgix transform Unsplash's CDN honours) puts this one in
      // black and white like the other two — it is the only colour shot of the
      // three, and side by side the difference read as a mistake.
      'https://images.unsplash.com/photo-1775322124421-19ba223a107c?w=1400&q=80&auto=format&fit=crop&sat=-100',
    fallback: 'radial-gradient(120% 90% at 30% 100%, #f2ebdf 0%, #e2d6c2 75%)',
  },
}
