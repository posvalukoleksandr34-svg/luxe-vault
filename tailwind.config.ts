import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Tailwind 3.3's default scale stops at multiples of 5 only up to 10 and
      // then every 10 (plus 25/75/95), so classes used across the site such as
      // text-foreground/85, bg-background/85 or bg-gold/15 compiled to nothing
      // and silently fell back to the inherited colour or no background.
      opacity: {
        '15': '0.15',
        '35': '0.35',
        '45': '0.45',
        '55': '0.55',
        '65': '0.65',
        '85': '0.85',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-display)', 'Didot', 'Georgia', 'serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        // The accent fill, kept under its old name: solid black now (see the
        // accent-role note on :root in app/globals.css).
        'gold-gradient': 'linear-gradient(hsl(var(--gold)), hsl(var(--gold)))',
      },
      // One crisp radius (2px, --radius) from rounded to rounded-3xl — the
      // soft 12–24px corners read as a template, not a fashion house.
      // rounded-full is untouched: pills, dots and avatars stay round.
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'var(--radius)',
        xl: 'var(--radius)',
        '2xl': 'var(--radius)',
        '3xl': 'var(--radius)',
      },
      // Preflight's own defaults, which are not neutral: a bare `ring` was
      // blue (#3b82f6), a bare `border` cool grey (#e5e7eb), and the
      // placeholder text gray-400 (#9ca3af, set under colors below). The ring
      // is a literal black, not hsl(var(--ring)): Tailwind cannot apply the
      // default ring opacity to a variable and silently falls back to blue-300.
      ringColor: {
        DEFAULT: '#000000',
      },
      borderColor: {
        DEFAULT: 'hsl(var(--border))',
        // Accent hairlines. `border-gold/40` and its kin were soft tan lines
        // on the old ivory; black at the same alpha is a hard mid-grey frame
        // (#999). A translucent accent border therefore takes half its
        // alpha — /40 draws like the #CCC hairline it used to resemble —
        // while the full-strength `border-gold` (selected and focus states)
        // stays crisp black.
        // (A literal fraction is halved; the full-strength class passes a CSS
        // variable, which is not a number, and is left as it is.)
        gold: (({ opacityValue }: { opacityValue?: string }) => {
          const alpha = Number(opacityValue)
          return Number.isFinite(alpha) && alpha < 1
            ? `hsl(var(--gold) / ${+(alpha / 2).toFixed(3)})`
            : `hsl(var(--gold) / ${opacityValue ?? 1})`
        }) as unknown as string,
      },
      // The accent as TEXT (--gold-ink) and as a fill (--gold) are both black
      // in the monochrome system; the split is kept so either can change
      // alone. textColor wins over colors for text-* utilities only.
      textColor: {
        gold: {
          DEFAULT: 'hsl(var(--gold-ink))',
          foreground: 'hsl(var(--gold-foreground))',
          light: 'hsl(var(--gold-ink))',
          dark: 'hsl(var(--gold-ink))',
        },
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        gold: {
          DEFAULT: 'hsl(var(--gold))',
          foreground: 'hsl(var(--gold-foreground))',
          light: 'hsl(var(--gold-light))',
          dark: 'hsl(var(--gold-dark))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        // Only so preflight's placeholder colour (it reads gray-400) is a
        // neutral grey, 4.7:1 on white. Nothing uses the gray scale itself.
        gray: { 400: '#737373' },
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-in-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'reveal-up': {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'line-grow': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-up': 'fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 0.4s ease-out',
        'slide-in-right': 'slide-in-right 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-left': 'slide-in-left 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        'shimmer': 'shimmer 2s linear infinite',
        'scale-in': 'scale-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'reveal-up': 'reveal-up 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        'line-grow': 'line-grow 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),

    /**
     * `size-*`, backported.
     *
     * The utility shipped in Tailwind 3.4; this project is on 3.3.3, where it
     * does not exist and therefore emits NOTHING. The codebase uses it about
     * 240 times — `<Icon className="size-4" />` on nearly every icon, and on
     * layout boxes like the size-filter chips.
     *
     * The result was invisible in review and obvious once measured: the
     * compiled stylesheet contained zero `.size-*` rules, so every icon fell
     * back to lucide's intrinsic 24px instead of the 16px the author asked
     * for, and the filter chips — declared `size-7`, i.e. 28x28 — rendered at
     * 9x19 with no dimensions at all.
     *
     * Defined here rather than by upgrading Tailwind: a minor-version bump
     * across a project this size is a much larger change than one utility,
     * and this is exactly the shape 3.4 gives it (width and height from the
     * spacing scale, arbitrary values allowed).
     */
    plugin(({ matchUtilities, theme }) => {
      matchUtilities(
        { size: (value) => ({ width: value, height: value }) },
        { values: theme('spacing') },
      );
    }),
  ],
};
export default config;
