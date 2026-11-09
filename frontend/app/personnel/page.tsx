'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Pencil, RotateCw, Trash2, X } from 'lucide-react'
import { Filters, Personnel, cap, n0, sendJson, signed, useApi } from '@/lib/api'
import PersonnelForm, { RANKS } from '@/components/PersonnelForm'
import { ErrorRetry, Loading, PageHead } from '@/components/ui'

const MAX_ROWS = 200

export default function PersonnelPage() {
  const [band, setBand] = useState('')
  const [unit, setUnit] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState({ name: '', rank: 'CPT', unit: '' })
  const [confirm, setConfirm] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const filters = useApi<Filters>('/api/filters')

  const q = new URLSearchParams({ active_only: 'false' })
  if (band) q.set('band', band)
  if (unit) q.set('unit', unit)
  const list = useApi<Personnel[]>(`/api/personnel?${q}`)
  // refetch after a write by bumping retry
  const reload = list.retry

  const [rows, setRows] = useState<Personnel[]>([])
  useEffect(() => { if (list.data) setRows(list.data) }, [list.data])
  const shown = useMemo(() => rows.slice(0, MAX_ROWS), [rows])
  const active = rows.filter(p => p.active).length

  const add = async (name: string, rank: string, u: string) => {
    await sendJson('/api/personnel', 'POST', { name, rank, unit: u, initial_elo: 1000 })
    reload()
  }
  const save = async (id: number) => {
    setActionError(null)
    try {
      await sendJson(`/api/personnel/${id}`, 'PUT', { name: draft.name.trim(), rank: draft.rank, unit: draft.unit.trim() || 'UNASSIGNED' })
      setEditing(null)
      reload()
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not save') }
  }
  const remove = async (id: number) => {
    setActionError(null)
    try {
      await sendJson(`/api/personnel/${id}`, 'DELETE')
      setConfirm(null)
      reload()
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not delete') }
  }

  const bandOptions = [...(filters.data?.bands.map(b => b.band) ?? []), 'unbanded']

  return (
    <div className="space-y-10">
      <PageHead title="Personnel." sub="Everyone who can be paired. Each person carries a performance rating and a potential rating, kept separately." />

      <PersonnelForm onSubmit={add} units={filters.data?.units ?? []} loading={list.loading && !list.data} />

      {actionError && <ErrorRetry message={actionError} onRetry={() => setActionError(null)} label="Change not saved" />}

      <section aria-labelledby="roster-h">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-6">
          <div>
            <h2 id="roster-h" className="display text-2xl sm:text-3xl">Roster</h2>
            <p className="tele mt-2" aria-live="polite">
              {list.data ? `Showing ${n0(shown.length)} of ${n0(rows.length)}${rows.length - active > 0 ? `, ${n0(rows.length - active)} inactive` : ''}` : 'Loading'}
              {rows.length > MAX_ROWS && ' [capped at 200, narrow with the filters]'}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="tele mb-1 block">Band</span>
              <select className="field !w-auto min-w-[120px] font-mono text-[13px]" value={band} onChange={e => setBand(e.target.value)}>
                <option value="">All bands</option>
                {bandOptions.map(b => <option key={b} value={b}>{cap(b)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="tele mb-1 block">Unit</span>
              <select className="field !w-auto min-w-[100px] font-mono text-[13px]" value={unit} onChange={e => setUnit(e.target.value)}>
                <option value="">All units</option>
                {(filters.data?.units ?? []).map(u => <option key={u}>{u}</option>)}
                <option value="UNASSIGNED">UNASSIGNED</option>
              </select>
            </label>
            <button className="pill-ghost !py-2" onClick={reload} disabled={list.loading}><RotateCw className="h-3.5 w-3.5" aria-hidden /> Refresh</button>
          </div>
        </div>

        {list.error && <ErrorRetry message={list.error} onRetry={list.retry} label="Could not load personnel" />}
        {list.loading && !list.data && <Loading label="Reading roster" />}

        {list.data && rows.length === 0 && (
          <div className="border border-line p-8">
            <p className="display text-2xl">No one here yet.</p>
            <p className="mt-2 max-w-md text-sm text-t2">
              {band || unit ? 'Nobody matches these filters. Clear them to see everyone.' : 'Add at least two people above, then start a round on the Rate page.'}
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <div className={`overflow-x-auto transition-opacity ${list.loading ? 'opacity-50' : ''}`}>
            <table className="w-full min-w-[860px]">
              <thead>
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Rank</th>
                  <th className="th">Unit</th>
                  <th className="th">Band</th>
                  <th className="th num">Performance</th>
                  <th className="th num">Potential</th>
                  <th className="th">Status</th>
                  <th className="th !pr-0 text-right">Actions</th>
                </tr>
                <tr>
                  <td colSpan={8} className="pb-2 text-[12px] text-t3">Enlisted ranks sit in a separate unbanded pool and are never rated against officers.</td>
                </tr>
              </thead>
              <tbody>
                {shown.map(p => {
                  const ed = editing === p.id
                  return (
                    <tr key={p.id} className="border-t border-line">
                      <td className="td">
                        {ed ? <input className="field !py-1" aria-label="Name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') save(p.id); if (e.key === 'Escape') setEditing(null) }} />
                          : <span className={p.active ? '' : 'text-t3 line-through'}>{p.name}</span>}
                      </td>
                      <td className="td font-mono text-t2">
                        {ed ? (
                          <select className="field !py-1" aria-label="Rank" value={draft.rank} onChange={e => setDraft(d => ({ ...d, rank: e.target.value }))}>
                            {Object.entries(RANKS).map(([g, rs]) => <optgroup key={g} label={g}>{rs.map(r => <option key={r}>{r}</option>)}</optgroup>)}
                          </select>
                        ) : p.rank}
                      </td>
                      <td className="td font-mono text-t2">
                        {ed ? <input className="field !py-1" aria-label="Unit" value={draft.unit} onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))} /> : p.unit}
                      </td>
                      <td className="td font-mono text-t2">{p.band}</td>
                      <td className="td num">{n0(p.current_elo)} <span className="text-t3">{signed(p.current_elo - p.initial_elo)}</span></td>
                      <td className="td num">{n0(p.current_potential)}</td>
                      <td className="td font-mono text-[11px] uppercase tracking-tele">{p.active ? <span className="text-t2">Active</span> : <span className="text-alert">[Inactive]</span>}</td>
                      <td className="td !pr-0">
                        <div className="flex justify-end gap-1">
                          {ed ? (
                            <>
                              <button className="p-2 text-t1 hover:bg-white/10" onClick={() => save(p.id)} aria-label={`Save ${p.name}`}><Check className="h-4 w-4" /></button>
                              <button className="p-2 text-t2 hover:bg-white/10" onClick={() => setEditing(null)} aria-label="Cancel edit"><X className="h-4 w-4" /></button>
                            </>
                          ) : confirm === p.id ? (
                            <>
                              <button className="px-2 font-mono text-[11px] uppercase tracking-tele text-alert hover:bg-alert/10" onClick={() => remove(p.id)}>Delete?</button>
                              <button className="p-2 text-t2 hover:bg-white/10" onClick={() => setConfirm(null)} aria-label="Cancel delete"><X className="h-4 w-4" /></button>
                            </>
                          ) : (
                            <>
                              <button className="p-2 text-t2 hover:bg-white/10 hover:text-t1" onClick={() => { setEditing(p.id); setDraft({ name: p.name, rank: p.rank, unit: p.unit }) }} aria-label={`Edit ${p.name}`}><Pencil className="h-4 w-4" /></button>
                              <button className="p-2 text-t2 hover:bg-white/10 hover:text-alert" onClick={() => setConfirm(p.id)} aria-label={`Delete ${p.name}`}><Trash2 className="h-4 w-4" /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
