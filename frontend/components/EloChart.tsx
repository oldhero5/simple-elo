'use client'

import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { format } from 'date-fns'
import { n0, useApi } from '@/lib/api'

export interface EloDataPoint { personnel_id: number; name: string; rank: string; rated_at: string; elo_score: number }
interface RoundDataPoint { personnel_id: number; name: string; rank: string; round_name: string; round_number: number; elo_score: number; round_dtg: string }

const tick = { fill: 'rgba(255,255,255,0.7)', fontSize: 11, fontFamily: 'var(--font-geist-mono)' }

/** Rating history per officer. Only mounted for small rosters (50 or fewer active personnel). */
export default function EloChart({ data }: { data: EloDataPoint[] }) {
  const [mode, setMode] = useState<'matchup' | 'round'>('round')
  const rounds = useApi<RoundDataPoint[]>('/api/elo-progression/by-rounds')

  const { rows, keys } = useMemo(() => {
    const keys = new Set<string>()
    const rows: Record<string, number | string>[] = []
    if (mode === 'round') {
      const nums = Array.from(new Set((rounds.data ?? []).map(p => p.round_number))).sort((a, b) => a - b)
      for (const rn of nums) {
        const row: Record<string, number | string> = { x: rn === 0 ? 'Start' : `R${rn}` }
        for (const p of (rounds.data ?? []).filter(p => p.round_number === rn)) {
          const k = `${p.rank} ${p.name}`; keys.add(k); row[k] = p.elo_score
        }
        rows.push(row)
      }
    } else {
      const cur: Record<string, number> = {}
      const sorted = [...data].sort((a, b) => +new Date(a.rated_at) - +new Date(b.rated_at))
      for (const p of sorted) {
        const k = `${p.rank} ${p.name}`; keys.add(k); cur[k] = p.elo_score
        rows.push({ x: format(new Date(p.rated_at), 'MMM dd HH:mm'), ...cur })
      }
    }
    return { rows, keys: Array.from(keys) }
  }, [mode, data, rounds.data])

  const empty = rows.length === 0
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-t2">{mode === 'round' ? 'Performance rating after each completed round.' : 'Performance rating after each comparison.'}</p>
        <div className="seg" role="group" aria-label="Chart view">
          <button aria-pressed={mode === 'round'} onClick={() => setMode('round')}>Per round</button>
          <button aria-pressed={mode === 'matchup'} onClick={() => setMode('matchup')}>Per comparison</button>
        </div>
      </div>
      {mode === 'round' && rounds.loading ? (
        <p className="tele py-10">Loading round history</p>
      ) : empty ? (
        <p className="tele py-10">No history yet. Complete a round or rate a pair.</p>
      ) : (
        <div className="h-[340px]" role="img" aria-label={`Rating history for ${keys.length} officers`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="x" tick={tick} stroke="rgba(255,255,255,0.3)" tickLine={false} minTickGap={24} />
              <YAxis tick={tick} stroke="rgba(255,255,255,0.3)" tickLine={false} width={46} domain={['dataMin - 25', 'dataMax + 25']} tickFormatter={v => n0(v)} />
              <Tooltip
                cursor={{ stroke: 'rgba(255,255,255,0.4)', strokeDasharray: '2 4' }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const top = [...payload].filter(p => p.value != null).sort((a, b) => (b.value as number) - (a.value as number)).slice(0, 6)
                  return (
                    <div className="border border-line-strong bg-black/95 px-3 py-2 font-mono text-[11px] tracking-tele text-t1">
                      <div className="uppercase text-t2">{label} &middot; top {top.length}</div>
                      {top.map(p => <div key={p.dataKey as string}>{n0(p.value as number)} {p.dataKey}</div>)}
                    </div>
                  )
                }}
              />
              {keys.map(k => (
                <Line key={k} dataKey={k} type="monotone" stroke="rgba(255,255,255,0.55)" strokeWidth={1.25} dot={false} activeDot={{ r: 3, fill: '#fff' }} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
