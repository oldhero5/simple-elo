'use client'

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ByQuarter, n0 } from '@/lib/api'

const tick = { fill: 'rgba(255,255,255,0.7)', fontSize: 11, fontFamily: 'var(--font-geist-mono)' }

export default function SpreadChart({ rows }: { rows: ByQuarter[] }) {
  const data = rows
    .filter(r => r.p10 != null && r.p50 != null && r.p90 != null)
    .map(r => ({ quarter: r.quarter, p10: r.p10 as number, p50: r.p50 as number, p90: r.p90 as number, base: r.p10 as number, band: (r.p90 as number) - (r.p10 as number), officers: r.officers }))
  if (data.length === 0) return <p className="tele py-10">No rated quarters in this window.</p>
  const lo = Math.floor(Math.min(...data.map(d => d.p10)) / 50) * 50 - 50
  const hi = Math.ceil(Math.max(...data.map(d => d.p90)) / 50) * 50 + 50
  return (
    <figure>
      <div className="h-[300px] w-full sm:h-[360px]" role="img" aria-label={`Rating spread by quarter: median, 10th and 90th percentile, quarters ${data[0].quarter} to ${data[data.length - 1].quarter}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis dataKey="quarter" tick={tick} tickFormatter={v => `Q${v}`} stroke="rgba(255,255,255,0.3)" tickLine={false} />
            <YAxis allowDataOverflow domain={[lo, hi]} tick={tick} stroke="rgba(255,255,255,0.3)" tickLine={false} width={46} tickFormatter={v => n0(v)} />
            <Tooltip
              cursor={{ stroke: 'rgba(255,255,255,0.4)', strokeDasharray: '2 4' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as (typeof data)[number]
                return (
                  <div className="border border-line-strong bg-black/95 px-3 py-2 font-mono text-[11px] tracking-tele text-t1">
                    <div className="uppercase">Quarter {d.quarter}</div>
                    <div className="text-t2">p90 {n0(d.p90)}</div>
                    <div>median {n0(d.p50)}</div>
                    <div className="text-t2">p10 {n0(d.p10)}</div>
                    <div className="text-t2">{n0(d.officers)} officers</div>
                  </div>
                )
              }}
            />
            <Area dataKey="base" stackId="s" stroke="none" fill="transparent" isAnimationActive={false} activeDot={false} />
            <Area dataKey="band" stackId="s" stroke="rgba(255,255,255,0.35)" strokeDasharray="2 4" fill="rgba(255,255,255,0.12)" isAnimationActive={false} activeDot={false} />
            <Line dataKey="p50" stroke="#fff" strokeWidth={2} dot={{ r: 3, fill: '#000', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 5, fill: '#fff', stroke: '#000', strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] uppercase tracking-tele text-t2">
        <span className="flex items-center gap-2"><span className="inline-block h-px w-5 bg-white" style={{ height: 2 }} />Median</span>
        <span className="flex items-center gap-2"><span className="inline-block h-3 w-5 border border-dashed border-white/40 bg-white/10" />10th to 90th percentile</span>
      </figcaption>
    </figure>
  )
}
