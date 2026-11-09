'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

interface Props {
  onSubmit: (name: string, rank: string, unit: string) => Promise<void>
  units: string[]
  loading?: boolean
}

export const RANKS = {
  Enlisted: ['PVT', 'PFC', 'SPC', 'CPL', 'SGT', 'SSG', 'SFC', 'MSG', 'SGM'],
  Officers: ['2LT', '1LT', 'CPT', 'MAJ', 'LTC', 'COL', 'BG', 'MG', 'LTG', 'GEN'],
}

export default function PersonnelForm({ onSubmit, units, loading = false }: Props) {
  const [name, setName] = useState('')
  const [rank, setRank] = useState('CPT')
  const [unit, setUnit] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(name.trim(), rank, unit.trim() || 'UNASSIGNED')
      setName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this person')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="border border-line p-5 sm:p-6" aria-labelledby="add-h">
      <h2 id="add-h" className="display text-2xl">Add a person</h2>
      <p className="mt-2 max-w-xl text-sm text-t2">New people start at 1,000 on both tracks and can be paired in the next round.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
        <label className="block">
          <span className="tele mb-1 block">Full name</span>
          <input className="field" value={name} onChange={e => setName(e.target.value)} maxLength={100} required disabled={submitting || loading} placeholder="Name" />
        </label>
        <label className="block">
          <span className="tele mb-1 block">Rank</span>
          <select className="field font-mono" value={rank} onChange={e => setRank(e.target.value)} disabled={submitting || loading}>
            {Object.entries(RANKS).map(([g, rs]) => (
              <optgroup key={g} label={g}>{rs.map(r => <option key={r}>{r}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="tele mb-1 block">Unit</span>
          <input className="field font-mono" list="unit-options" value={unit} onChange={e => setUnit(e.target.value)} maxLength={40} placeholder="UNASSIGNED" disabled={submitting || loading} />
          <datalist id="unit-options">{units.map(u => <option key={u} value={u} />)}</datalist>
        </label>
        <button type="submit" className="pill" disabled={!name.trim() || submitting || loading}>
          <Plus className="h-4 w-4" aria-hidden /> {submitting ? 'Adding' : 'Add'}
        </button>
      </div>
      {error && <p role="alert" className="mt-4 border-l-2 border-alert pl-3 text-sm text-alert">{error}</p>}
    </form>
  )
}
