import type { ShapeLevel } from '@/lib/fit-advisor'

/**
 * The silhouettes for the hips and abdomen questions: a front view for hips,
 * a side view for the abdomen, each drawn from one parameter so the three
 * answers are visibly the same body with one thing changed. Line art in the
 * shop's sand and gold, deliberately without a face or skin tone — it is a
 * diagram of a shape, not a model.
 *
 * Decorative for assistive technology: the radio buttons under it carry the
 * question and the answer.
 */

const SAND_TOP = '#f1ebe1'
const SAND_BOTTOM = '#e2d7c6'
const LINE = '#b5a68f'
const GOLD = '#b8924a'

function Frame({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 220 240" className="h-full w-auto" aria-hidden focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={SAND_TOP} />
          <stop offset="1" stopColor={SAND_BOTTOM} />
        </linearGradient>
      </defs>
      {children}
    </svg>
  )
}

/** Front view; `level` widens or narrows the hips. */
export function HipsFigure({ level }: { level: ShapeLevel }) {
  const c = 110
  const hip = 52 + level * 10 // half-width at the hips
  const thigh = 44 + level * 6
  const L = (dx: number) => c - dx
  const R = (dx: number) => c + dx
  const d = [
    `M ${L(18)} 10`,
    `C ${L(30)} 18 ${L(50)} 22 ${L(58)} 32`,
    `C ${L(61)} 46 ${L(53)} 56 ${L(50)} 64`,
    `C ${L(45)} 88 ${L(38)} 102 ${L(38)} 122`,
    `C ${L(38)} 142 ${L(hip)} 150 ${L(hip)} 170`,
    `C ${L(hip - 1)} 192 ${L(thigh)} 212 ${L(thigh)} 238`,
    `L ${L(7)} 238`,
    `C ${L(5)} 222 ${R(5)} 222 ${R(7)} 238`,
    `L ${R(thigh)} 238`,
    `C ${R(thigh)} 212 ${R(hip - 1)} 192 ${R(hip)} 170`,
    `C ${R(hip)} 150 ${R(38)} 142 ${R(38)} 122`,
    `C ${R(38)} 102 ${R(45)} 88 ${R(50)} 64`,
    `C ${R(53)} 56 ${R(61)} 46 ${R(58)} 32`,
    `C ${R(50)} 22 ${R(30)} 18 ${R(18)} 10`,
    'Z',
  ].join(' ')
  const guide = (side: 1 | -1) => {
    const x = c + side * (hip + 9)
    return `M ${x} 140 C ${x + side * 9} 160 ${x + side * 9} 182 ${x} 202`
  }
  return (
    <Frame id="lv-hips-fill">
      <path d={d} fill="url(#lv-hips-fill)" stroke={LINE} strokeWidth="1.2" strokeLinejoin="round" />
      {/* The waistband of a brief: where hips are read. */}
      <path d={`M ${L(hip - 3)} 176 Q ${c} 196 ${R(hip - 3)} 176`} fill="none" stroke={LINE} strokeWidth="1" />
      <path d={guide(-1)} fill="none" stroke={GOLD} strokeWidth="1.6" strokeDasharray="5 5" strokeLinecap="round" />
      <path d={guide(1)} fill="none" stroke={GOLD} strokeWidth="1.6" strokeDasharray="5 5" strokeLinecap="round" />
    </Frame>
  )
}

/** Side view, facing right; `level` flattens or rounds the abdomen. */
export function AbdomenFigure({ level }: { level: ShapeLevel }) {
  const belly = 126 + level * 13
  const lower = 120 + level * 6
  const d = [
    'M 92 10',
    'C 84 22 78 34 80 52',
    'C 82 76 90 96 88 116',
    'C 86 140 74 156 78 178',
    'C 82 200 88 218 88 238',
    'L 120 238',
    `C 120 214 ${lower - 2} 190 ${lower} 172`,
    `C ${lower + 3} 156 ${belly} 148 ${belly} 132`,
    `C ${belly} 114 124 100 126 86`,
    'C 132 76 140 62 134 48',
    'C 128 34 118 24 114 10',
    'Z',
  ].join(' ')
  const gx = belly + 10
  return (
    <Frame id="lv-belly-fill">
      <path d={d} fill="url(#lv-belly-fill)" stroke={LINE} strokeWidth="1.2" strokeLinejoin="round" />
      <path
        d={`M ${gx} 106 C ${gx + 10} 122 ${gx + 10} 146 ${gx - 2} 162`}
        fill="none"
        stroke={GOLD}
        strokeWidth="1.6"
        strokeDasharray="5 5"
        strokeLinecap="round"
      />
    </Frame>
  )
}
