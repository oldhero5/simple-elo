'use client'

import { useCallback, useEffect, useState } from 'react'

// Same origin by default: app/api/[...path]/route.ts forwards /api to the backend,
// so the app works from any address on ALLOWED_HOSTS that reaches port 3000.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export type Track = 'performance' | 'potential'

export interface Meta { synthetic: boolean; label: string; source: string; notes: string[] }
export interface Filters { tracks: Track[]; bands: { band: string; officers: number }[]; units: string[]; quarters: number[] }

export interface Summary {
  comparisons: number; cant_judge: number; draws: number
  cross_unit_comparisons: number; officers: number; cross_unit_share: number | null
}
export interface ByBand { band: string; officers: number; mean: number | null; sd: number | null; p10: number | null; p50: number | null; p90: number | null }
export interface ByQuarter {
  quarter: number; officers: number; mean: number | null; sd: number | null
  p10: number | null; p50: number | null; p90: number | null; comparisons: number; cross_unit_comparisons: number
}
export interface ByUnit {
  unit: string; officers: number; mean_rating: number | null; comparisons: number
  cross_n: number; cross_win_rate: number | null
  early_n: number; early_rate: number | null; late_n: number; late_rate: number | null
  cross_win_rate_change: number | null; cross_win_rate_change_se: number | null
}
export interface UnitLink { unit_a: string; unit_b: string; comparisons: number }
export interface Leader {
  id: number; name: string; rank: string; unit: string; rating: number
  change: number; comparisons: number; wins: number; losses: number; draws: number
}
export interface Population {
  filters: { track: Track; band: string | null; unit: string | null; quarter_from: number | null; quarter_to: number | null }
  synthetic: boolean; summary: Summary; by_band: ByBand[]; by_quarter: ByQuarter[]
  by_unit: ByUnit[]; unit_links: UnitLink[]; leaderboard: Leader[]
}

export interface ReplayOfficer {
  id: number; name: string; rank: string; unit: string; position: number
  recorded: number; mean: number; sd: number; min: number; max: number; rank_sd: number
}
export interface Replay {
  shuffles: number; seed: number
  summary: {
    officers: number; comparisons: number; median_sd: number | null; p95_sd: number | null; max_sd: number | null
    median_range: number | null; median_rank_sd: number | null; median_sd_of_mean: number | null; max_sd_of_mean: number | null
  }
  officers: ReplayOfficer[]
}

export interface Personnel {
  id: number; name: string; rank: string; unit: string; band: string
  initial_elo: number; current_elo: number; current_potential: number
  created_at: string; active: boolean; synthetic: boolean
}

// Display helpers. Ratings arrive as unrounded floats.
export const n0 = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US')
export const n1 = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const pct = (v: number | null | undefined, d = 1) =>
  v == null ? '—' : `${(v * 100).toFixed(d)}%`
export const signed = (v: number | null | undefined, d = 0) => {
  if (v == null) return '—'
  const r = Number(v.toFixed(d))
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { signal })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json()).detail } catch { /* ignore */ }
    const err = new Error(detail || `Request failed (${res.status})`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return res.json()
}

export async function sendJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch { /* ignore */ }
    throw new Error(detail || `Request failed (${res.status})`)
  }
  return res.json()
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(path != null)
  const [tick, setTick] = useState(0)
  const retry = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (path == null) { setData(null); setLoading(false); setError(null); return }
    const ctl = new AbortController()
    setLoading(true)
    setError(null)
    getJson<T>(path, ctl.signal)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => {
        if (ctl.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Request failed')
        setLoading(false)
      })
    return () => ctl.abort()
  }, [path, tick])

  return { data, error, loading, retry }
}
