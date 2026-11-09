'use client'

import { useMemo, useState } from 'react'
import { ReplayOfficer, n0, n1 } from '@/lib/api'

/** Per-officer range over the shuffles: min to max bar, mean tick, recorded-order marker. */
export default function RangeChart({ officers }: { officers: ReplayOfficer[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const rows = officers
  const { lo, hi } = useMemo(() => {
    const vals = rows.flatMap(o => [o.min, o.max, o.recorded])
    const a = Math.min(...vals), b = Math.max(...vals)
    const pad = Math.max((b - a) * 0.03, 1)
    return { lo: a - pad, hi: b + pad }
  }, [rows])
  if (!rows.length) return <p className="tele py-8">No officers match this view.</p>

  const left = 150, right = 16, rowH = 22, top = 26, W = 900
  const H = top + rows.length * rowH + 8
  const x = (v: number) => left + ((v - lo) / (hi - lo)) * (W - left - right)
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)

  return (
    <figure>
      <div className="overflow-x-auto sm:overflow-visible">
        <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[640px] w-full" role="img" aria-label={`Rating range across shuffles for the top ${rows.length} officers by mean`}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={top - 6} y2={H - 6} stroke="rgba(255,255,255,0.08)" />
              <text x={x(t)} y={12} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="11" fontFamily="var(--font-geist-mono)">{n0(t)}</text>
            </g>
          ))}
          {rows.map((o, i) => {
            const y = top + i * rowH + rowH / 2
            const on = hover === o.id
            return (
              <g key={o.id} onPointerEnter={() => setHover(o.id)} onPointerLeave={() => setHover(null)}>
                <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill={on ? 'rgba(255,255,255,0.06)' : 'transparent'} />
                <text x={0} y={y + 4} fill={on ? '#fff' : 'rgba(255,255,255,0.78)'} fontSize="11" fontFamily="var(--font-geist-mono)">
                  {String(i + 1).padStart(2, '0')} {o.rank} {o.name.replace('Synthetic Officer ', 'Officer ')} {o.unit}
                </text>
                <line x1={x(o.min)} x2={x(o.max)} y1={y} y2={y} stroke="rgba(255,255,255,0.55)" strokeWidth={4} strokeLinecap="round" />
                <line x1={x(o.mean)} x2={x(o.mean)} y1={y - 8} y2={y + 8} stroke="#fff" strokeWidth={2} />
                <circle cx={x(o.recorded)} cy={y} r={4.5} fill="#000" stroke="#7aebff" strokeWidth={2} />
              </g>
            )
          })}
        </svg>
      </div>
      <div className="mt-2 min-h-[1.5rem] font-mono text-[11px] uppercase tracking-tele text-t2" aria-live="polite">
        {hover != null
          ? (() => { const o = rows.find(r => r.id === hover)!; return `${o.name}: recorded ${n0(o.recorded)}, mean ${n1(o.mean)}, range ${n1(o.min)} to ${n1(o.max)}, sd ${n1(o.sd)}, rank sd ${n1(o.rank_sd)}` })()
          : 'Hover a row for its numbers'}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] uppercase tracking-tele text-t2">
        <span className="flex items-center gap-2"><span className="inline-block w-5 rounded-full bg-white/55" style={{ height: 4 }} />Min to max over shuffles</span>
        <span className="flex items-center gap-2"><span className="inline-block h-3 w-0.5 bg-white" />Mean</span>
        <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-signal" />Recorded order</span>
      </figcaption>
    </figure>
  )
}
