import { Table2 } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * Single-series column chart (magnitude over time). Spec: ≤24px columns with a 4px rounded data-end
 * and a square baseline, hairline recessive grid, clean y ticks, per-column hover tooltip with a hit
 * target taller than the mark, and a table view. One series → no legend; the card title names it.
 */
export function BarChart({
  data,
  format,
  height = 160,
  label,
}: {
  data: { key: string; label: string; value: number; sub?: string }[];
  format: (v: number) => string;
  height?: number;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const { ticks, max } = useMemo(() => niceTicks(Math.max(0, ...data.map((d) => d.value))), [data]);
  const width = 640;
  const padL = 44;
  const padB = 22;
  const plotH = height - padB - 8;
  const band = (width - padL) / Math.max(1, data.length);
  const barW = Math.min(24, band * 0.6);

  if (table)
    return (
      <div>
        <ToggleTable onClick={() => setTable(false)} active />
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1.5 font-medium">Период</th>
              <th className="py-1.5 text-right font-medium">{label}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key} className="border-t border-line">
                <td className="py-1.5">{d.label}</td>
                <td className="py-1.5 text-right font-mono tabular">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className="relative">
      <ToggleTable onClick={() => setTable(true)} />
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => {
          const y = 8 + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={width} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" className="fill-[var(--faint)] font-mono text-[10px] tabular">
                {format(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = max ? (d.value / max) * plotH : 0;
          const x = padL + i * band + (band - barW) / 2;
          const y = 8 + plotH - h;
          const r = Math.min(4, h);
          const path = h > 0
            ? `M${x},${8 + plotH} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + barW - r},${y} Q${x + barW},${y} ${x + barW},${y + r} L${x + barW},${8 + plotH} Z`
            : "";
          return (
            <g key={d.key}>
              <rect x={padL + i * band} y={0} width={band} height={height - padB} fill="transparent"
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`} />
              {path && <path d={path} fill="var(--chart-1)" opacity={hover === null || hover === i ? 1 : 0.55} pointerEvents="none" />}
              {(data.length <= 14 || i % Math.ceil(data.length / 10) === 0) && (
                <text x={padL + i * band + band / 2} y={height - 6} textAnchor="middle" className="fill-[var(--faint)] text-[10px]">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line-strong bg-elevated px-2.5 py-1.5 text-xs shadow-xl"
          style={{ left: `${((padL + hover * band + band / 2) / width) * 100}%` }}
        >
          <p className="text-muted">{data[hover].label}</p>
          <p className="font-medium text-text">{format(data[hover].value)}</p>
          {data[hover].sub && <p className="text-faint">{data[hover].sub}</p>}
        </div>
      )}
    </div>
  );
}

function ToggleTable({ onClick, active }: { onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className={`absolute -top-9 right-0 rounded-md p-1 ${active ? "text-accent" : "text-faint hover:text-muted"}`}
      title={active ? "Показать график" : "Показать таблицей"} aria-label="Переключить вид">
      <Table2 className="size-3.5" />
    </button>
  );
}

function niceTicks(maxValue: number): { ticks: number[]; max: number } {
  if (maxValue <= 0) return { ticks: [0], max: 1 };
  const rough = maxValue / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? rough;
  const max = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(Number(t.toFixed(6)));
  return { ticks, max };
}
