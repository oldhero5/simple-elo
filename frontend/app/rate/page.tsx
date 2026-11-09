'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, HelpCircle, Minus } from 'lucide-react'
import { Filters, Meta, Personnel, Track, cap, getJson, n0, n1, pct, sendJson, signed, useApi } from '@/lib/api'
import { ErrorRetry, Loading, PageHead, Section } from '@/components/ui'

interface RoundInfo { id: number; round_name: string; dtg: string; status: string; total_matchups: number; completed_matchups: number; track: Track; quarter: number; band: string | null; design: Design }
interface Design {
  bands?: { band: string; pairs: number; realised_cross_unit_share: number | null; min_comparisons: number; max_comparisons: number; unit_groups: number }[]
  warnings?: string[]
}
interface Preview { a_new: number; b_new: number; a_change: number; b_change: number }
interface Pair {
  round_info: RoundInfo
  matchup: { id: number }
  person_a: Personnel
  person_b: Personnel
  track: Track
  question: string
  rating_a: number
  rating_b: number
  cross_unit: boolean
  expected_scores: { a_expected: number; b_expected: number }
  rating_preview: { a_wins: Preview; b_wins: Preview; draw: Preview; cant_judge?: unknown }
  progress: { total_matchups: number; completed_matchups: number; remaining_matchups: number; completion_percentage: number; cant_judge?: number }
}
interface Results {
  round: RoundInfo
  leaderboard: { id: number; name: string; rank: string; band: string; unit: string; starting_elo: number; final_elo: number; elo_change: number }[]
  statistics: { total_ratings: number; cant_judge?: number; biggest_elo_gain: number; biggest_elo_loss: number; total_personnel: number }
}

type Choice = 'a' | 'b' | 'tie' | 'cant'

export default function RatePage() {
  const [pair, setPair] = useState<Pair | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [answered, setAnswered] = useState(0)
  const [results, setResults] = useState<Results | null>(null)
  const [justFinished, setJustFinished] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setPair(await getJson<Pair>('/api/comparison/full'))
      setResults(null)
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 404) {
        setPair(null)
        try {
          const done = await getJson<{ id: number }[]>('/api/rounds/completed?limit=1')
          setResults(done.length ? await getJson<Results>(`/api/rounds/${done[0].id}/results`) : null)
        } catch { setResults(null) }
      } else {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const answer = useCallback(async (c: Choice) => {
    if (!pair || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await sendJson('/api/rate', 'POST', {
        round_id: pair.round_info.id,
        matchup_id: pair.matchup.id,
        ratee_a_id: pair.person_a.id,
        ratee_b_id: pair.person_b.id,
        winner_id: c === 'a' ? pair.person_a.id : c === 'b' ? pair.person_b.id : null,
        cant_judge: c === 'cant',
        rater_id: null,
      })
      setAnswered(n => n + 1)
      if (pair.progress.remaining_matchups <= 1) setJustFinished(true)
      await load()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save the answer')
    } finally {
      setSubmitting(false)
    }
  }, [pair, submitting, load])

  // keyboard shortcuts
  useEffect(() => {
    if (!pair) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return
      const k = e.key.toLowerCase()
      if (k === 'a' || k === 'arrowleft') answer('a')
      else if (k === 'b' || k === 'arrowright') answer('b')
      else if (k === 't') answer('tie')
      else if (k === 'j') answer('cant')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pair, answer])

  if (loading) return <Loading label="Looking for a pending comparison" />
  if (error) return <ErrorRetry message={error} onRetry={() => { setLoading(true); load() }} label="Could not load the comparison" />

  if (!pair) {
    return (
      <SetupView
        results={results}
        justFinished={justFinished}
        answered={answered}
        onStarted={() => { setJustFinished(false); setAnswered(0); setLoading(true); load() }}
      />
    )
  }

  const { person_a: A, person_b: B, progress, round_info: R } = pair
  const done = progress.completed_matchups
  const frac = progress.total_matchups ? done / progress.total_matchups : 0

  return (
    <div>
      <div className="boot mb-8" style={{ ['--i' as string]: 0 }}>
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="tele-strong">{pair.track} track</span>
          <span className="tele">{R.round_name}</span>
          {R.band && <span className="tele">{R.band} band</span>}
          {pair.cross_unit && <span className="border border-signal px-2 py-0.5 font-mono text-[11px] uppercase tracking-tele text-signal">Cross-unit pair [{A.unit} / {B.unit}]</span>}
        </div>
        <h1 className="display max-w-4xl text-3xl sm:text-5xl">{pair.question}</h1>
        {pair.track === 'potential' && (
          <p className="mt-4 border-l-2 border-amber pl-3 text-[13px] text-t2">
            <span className="font-mono text-[11px] uppercase tracking-tele text-amber">[Seed script]</span> Potential answers in this demo are generated by the seed script, not the simulation.
          </p>
        )}
      </div>

      <div className="mb-8">
        <div className="mb-2 flex justify-between font-mono text-[11px] uppercase tracking-tele text-t2">
          <span>Progress: {n0(done)} / {n0(progress.total_matchups)}</span>
          <span>{pct(frac, 1)} [{n0(progress.remaining_matchups)} left]</span>
        </div>
        <div className="h-px w-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total_matchups} aria-valuenow={done} aria-label="Round progress">
          <div className="h-[3px] -translate-y-px bg-white transition-[width] duration-500" style={{ width: `${Math.max(frac * 100, 0.3)}%`, transitionTimingFunction: 'var(--ease)' }} />
        </div>
      </div>

      <div className="grid gap-px border border-line bg-line md:grid-cols-2">
        <Option label="A" k="A" person={A} rating={pair.rating_a} expected={pair.expected_scores.a_expected} disabled={submitting} onPick={() => answer('a')} />
        <Option label="B" k="B" person={B} rating={pair.rating_b} expected={pair.expected_scores.b_expected} disabled={submitting} onPick={() => answer('b')} />
      </div>

      <div className="mt-px grid gap-px border border-t-0 border-line bg-line sm:grid-cols-2">
        <button onClick={() => answer('tie')} disabled={submitting} className="group bg-black p-5 text-left transition-colors hover:bg-white/[0.06] disabled:opacity-50">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-lg font-medium tracking-tight"><Minus className="h-4 w-4" aria-hidden /> Tie</span>
            <kbd className="font-mono text-[11px] text-t3">T</kbd>
          </div>
          <p className="mt-1 text-sm text-t2">The two are equal. A tie is scored as a draw and moves both ratings toward each other.</p>
        </button>
        <button onClick={() => answer('cant')} disabled={submitting} className="group bg-black p-5 text-left transition-colors hover:bg-white/[0.06] disabled:opacity-50">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-lg font-medium tracking-tight"><HelpCircle className="h-4 w-4" aria-hidden /> I can&apos;t judge</span>
            <kbd className="font-mono text-[11px] text-t3">J</kbd>
          </div>
          <p className="mt-1 text-sm text-t2">You do not know enough to compare them. The answer is recorded and no rating moves.</p>
        </button>
      </div>

      {submitError && <div className="mt-4"><ErrorRetry message={submitError} onRetry={() => setSubmitError(null)} label="Answer not saved" /></div>}

      <div className="mt-8 grid gap-6 border-t border-line pt-5 sm:grid-cols-4">
        {([
          ['If A', pair.rating_preview.a_wins],
          ['If B', pair.rating_preview.b_wins],
          ['If tie', pair.rating_preview.draw],
        ] as [string, Preview][]).map(([k, p]) => (
          <div key={k}>
            <div className="tele-strong">{k}</div>
            <div className="mt-1 font-mono text-[13px] tabular-nums text-t2">A {signed(p.a_change, 1)}</div>
            <div className="font-mono text-[13px] tabular-nums text-t2">B {signed(p.b_change, 1)}</div>
          </div>
        ))}
        <div>
          <div className="tele-strong">If can&apos;t judge</div>
          <div className="mt-1 font-mono text-[13px] text-t2">No rating change</div>
        </div>
      </div>
      <p className="tele mt-6">Keys: A or left arrow, B or right arrow, T tie, J can&apos;t judge. This session: {answered} answered.</p>
    </div>
  )
}

function Option({ label, k, person, rating, expected, disabled, onPick }: {
  label: string; k: string; person: Personnel; rating: number; expected: number; disabled: boolean; onPick: () => void
}) {
  return (
    <button onClick={onPick} disabled={disabled} className="group relative bg-black p-6 text-left transition-colors hover:bg-white/[0.06] focus-visible:z-10 disabled:opacity-50 sm:p-8">
      <div className="flex items-start justify-between">
        <span className="font-mono text-[11px] uppercase tracking-tele text-t3">Officer {label}</span>
        <kbd className="border border-line-strong px-2 py-0.5 font-mono text-[11px] text-t2">{k}</kbd>
      </div>
      <div className="mt-6 display text-3xl sm:text-5xl">{person.name.replace('Synthetic Officer ', 'Officer ')}</div>
      <dl className="mt-6 grid grid-cols-2 gap-y-3 font-mono text-[11px] uppercase tracking-tele sm:grid-cols-4">
        <div><dt className="text-t3">Rank</dt><dd className="mt-1 text-base normal-case text-t1">{person.rank}</dd></div>
        <div><dt className="text-t3">Unit</dt><dd className="mt-1 text-base normal-case text-t1">{person.unit}</dd></div>
        <div><dt className="text-t3">Rating</dt><dd className="mt-1 text-base tabular-nums text-t1">{n0(rating)}</dd></div>
        <div><dt className="text-t3">Expected</dt><dd className="mt-1 text-base tabular-nums text-t1">{pct(expected, 0)}</dd></div>
      </dl>
      <span className="mt-6 inline-flex items-center gap-2 text-sm text-t2 group-hover:text-t1"><Check className="h-4 w-4" aria-hidden /> {label} is stronger</span>
    </button>
  )
}

function SetupView({ results, justFinished, answered, onStarted }: { results: Results | null; justFinished: boolean; answered: number; onStarted: () => void }) {
  const filters = useApi<Filters>('/api/filters')
  const meta = useApi<Meta>('/api/meta')
  const [track, setTrack] = useState<Track>('performance')
  const [band, setBand] = useState('tactical')
  const [per, setPer] = useState(10)
  const [share, setShare] = useState(20)
  const [quarter, setQuarter] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [design, setDesign] = useState<{ round: RoundInfo; design: Design } | null>(null)

  const create = async () => {
    setBusy(true); setErr(null)
    try {
      const body: Record<string, unknown> = { track, comparisons_per_officer: per, cross_unit_share: share / 100, band }
      if (quarter) body.quarter = Number(quarter)
      const r = await sendJson<{ round: RoundInfo }>('/api/rounds/new', 'POST', body)
      setDesign({ round: r.round, design: r.round.design ?? {} })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the round')
    } finally { setBusy(false) }
  }

  const potentialNote = meta.data?.notes.find(n => n.startsWith('Potential'))
  return (
    <div className="space-y-14">
      <PageHead
        title={justFinished ? 'Round complete.' : 'Set up a round.'}
        sub={justFinished
          ? `${answered} answers recorded this session. Results are below; start another round whenever you like.`
          : 'No comparison is waiting. A round pairs officers inside one band, with a set share of pairs that cross unit lines.'}
      />

      <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-label="Round setup">
        <div className="space-y-6">
          <div>
            <span className="tele mb-1 block">Track</span>
            <div className="seg">
              {(['performance', 'potential'] as Track[]).map(t => <button key={t} aria-pressed={track === t} onClick={() => setTrack(t)}>{t}</button>)}
            </div>
            {track === 'potential' && (
              <p className="mt-3 border-l-2 border-amber pl-3 text-[13px] text-t2">
                <span className="font-mono text-[11px] uppercase tracking-tele text-amber">[Seed script]</span>{' '}
                Potential answers in this demo are generated by the seed script, not the simulation. {potentialNote ? potentialNote.replace(/^Potential answers are generated by seed_demo\.py, not the simulation:\s*/, '') : ''}
              </p>
            )}
          </div>
          <div>
            <span className="tele mb-1 block">Band</span>
            <div className="seg">
              {(filters.data?.bands.map(b => b.band) ?? ['tactical', 'operational', 'strategic']).map(b => <button key={b} aria-pressed={band === b} onClick={() => setBand(b)}>{b}</button>)}
            </div>
          </div>
          <label className="block">
            <span className="tele mb-1 flex justify-between"><span>Comparisons per officer</span><span className="text-t1">{per}</span></span>
            <input type="range" min={7} max={15} step={1} value={per} onChange={e => setPer(Number(e.target.value))} className="w-full" />
          </label>
          <label className="block">
            <span className="tele mb-1 flex justify-between"><span>Cross-unit share</span><span className="text-t1">{share}%</span></span>
            <input type="range" min={0} max={50} step={1} value={share} onChange={e => setShare(Number(e.target.value))} className="w-full" />
          </label>
          <label className="block max-w-[200px]">
            <span className="tele mb-1 block">Quarter (optional)</span>
            <select className="field font-mono text-[13px]" value={quarter} onChange={e => setQuarter(e.target.value)}>
              <option value="">Not set</option>
              {(filters.data?.quarters ?? []).map(q => <option key={q} value={q}>Q{q}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <button className="pill" onClick={create} disabled={busy}>{busy ? 'Creating round' : 'Create round'}</button>
            <p className="max-w-xs text-[13px] text-t2">Creating a round closes any round that is still open.</p>
          </div>
          {err && <ErrorRetry message={err} onRetry={create} label="Round not created" />}
        </div>

        <div className="border border-line p-6" aria-live="polite">
          <p className="tele-strong">Round design</p>
          {!design && <p className="mt-3 max-w-sm text-sm text-t2">Pairs, realised cross-unit share and any warnings appear here after you create a round.</p>}
          {design && (
            <div className="mt-4 space-y-5">
              <p className="text-sm text-t2">{design.round.round_name} [{design.round.track}, {design.round.total_matchups.toLocaleString('en-US')} matchups]</p>
              {(design.design.bands ?? []).map(b => (
                <div key={b.band} className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-line pt-3 font-mono text-[13px] sm:grid-cols-3">
                  <div className="col-span-2 tele-strong sm:col-span-3">{b.band}</div>
                  <div><span className="tele block">Pairs</span>{n0(b.pairs)}</div>
                  <div><span className="tele block">Cross-unit share</span>{pct(b.realised_cross_unit_share)}</div>
                  <div><span className="tele block">Per officer</span>{b.min_comparisons} to {b.max_comparisons}</div>
                </div>
              ))}
              {(design.design.warnings ?? []).map(w => (
                <p key={w} className="border-l-2 border-amber pl-3 text-[13px] text-t2"><span className="font-mono text-[11px] uppercase tracking-tele text-amber">[Warning]</span> {w}</p>
              ))}
              {(design.design.warnings ?? []).length === 0 && <p className="tele">Warnings: [NONE]</p>}
              <button className="pill" onClick={onStarted}>Start rating</button>
            </div>
          )}
        </div>
      </section>

      {results ? <ResultsTable results={results} /> : <p className="tele">No completed round yet.</p>}
    </div>
  )
}

function ResultsTable({ results }: { results: Results }) {
  const bands = useMemo(() => Array.from(new Set(results.leaderboard.map(r => r.band))).sort(), [results])
  const [band, setBand] = useState<string>('')
  const active = band || bands[0] || ''
  const rows = useMemo(() => results.leaderboard.filter(r => r.band === active).sort((a, b) => b.final_elo - a.final_elo), [results, active])
  const s = results.statistics
  return (
    <Section title="Last completed round" aside={`${results.round.round_name}, ${results.round.track} track. Standings are within a band.`}>
      <div className="mb-6 grid grid-cols-2 gap-x-6 sm:grid-cols-5">
        {[
          ['Answers', n0(s.total_ratings)], ["Can't judge", n0(s.cant_judge ?? 0)], ['Officers', n0(s.total_personnel)],
          ['Biggest gain', signed(s.biggest_elo_gain)], ['Biggest loss', signed(s.biggest_elo_loss)],
        ].map(([k, v]) => (
          <div key={k} className="border-t border-line py-3"><div className="tele">{k}</div><div className="mt-1 font-mono text-xl tabular-nums">{v}</div></div>
        ))}
      </div>
      {bands.length > 1 && (
        <div className="seg mb-4" role="group" aria-label="Band">
          {bands.map(b => <button key={b} aria-pressed={active === b} onClick={() => setBand(b)}>{b}</button>)}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px]">
          <thead><tr>
            <th className="th">#</th><th className="th">Name</th><th className="th">Rank</th><th className="th">Unit</th>
            <th className="th num">Starting</th><th className="th num">Final</th><th className="th num !pr-0">Change</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, 25).map((r, i) => (
              <tr key={r.id} className="border-t border-line">
                <td className="td font-mono text-t3">{i + 1}</td><td className="td">{r.name}</td>
                <td className="td font-mono text-t2">{r.rank}</td><td className="td font-mono text-t2">{r.unit}</td>
                <td className="td num">{n0(r.starting_elo)}</td><td className="td num">{n0(r.final_elo)}</td>
                <td className="td num !pr-0">{signed(r.elo_change, 1)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-t3" colSpan={7}>No officers in this band.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="tele mt-3">Showing {Math.min(25, rows.length)} of {n0(rows.length)} {cap(active)} officers, ordered by final rating.</p>
      <div className="mt-6"><Link href="/" className="pill-ghost">Back to dashboard</Link></div>
    </Section>
  )
}
