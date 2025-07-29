'use client'

import { useState } from 'react'
import { Plus, UserPlus } from 'lucide-react'

interface PersonnelFormProps {
  onSubmit: (name: string, rank: string) => Promise<void>
  loading?: boolean
}

const MILITARY_RANKS = [
  'PVT', 'PFC', 'SPC', 'CPL', 'SGT', 'SSG', 'SFC', 'MSG', 'SGM',
  '2LT', '1LT', 'CPT', 'MAJ', 'LTC', 'COL', 'BG', 'MG', 'LTG', 'GEN'
]

export default function PersonnelForm({ onSubmit, loading = false }: PersonnelFormProps) {
  const [name, setName] = useState('')
  const [rank, setRank] = useState('SPC')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) return

    try {
      setSubmitting(true)
      await onSubmit(name.trim(), rank)
      setName('')
      setRank('SPC')
    } catch (error) {
      // Error handling is done in parent component
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card">
      <div className="mb-6">
        <h2 className="text-2xl font-bold font-mono text-military-light mb-2 flex items-center">
          <UserPlus className="h-6 w-6 mr-3 text-military-green" />
          ADD PERSONNEL
        </h2>
        <p className="text-military-muted">Register new personnel for evaluation</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-military-light mb-2 font-mono"
            >
              FULL NAME
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field w-full"
              placeholder="Enter full name"
              required
              disabled={submitting || loading}
              maxLength={100}
            />
          </div>

          <div>
            <label
              htmlFor="rank"
              className="block text-sm font-medium text-military-light mb-2 font-mono"
            >
              RANK
            </label>
            <select
              id="rank"
              value={rank}
              onChange={(e) => setRank(e.target.value)}
              className="input-field w-full"
              required
              disabled={submitting || loading}
            >
              <optgroup label="Enlisted">
                <option value="PVT">PVT - Private</option>
                <option value="PFC">PFC - Private First Class</option>
                <option value="SPC">SPC - Specialist</option>
                <option value="CPL">CPL - Corporal</option>
                <option value="SGT">SGT - Sergeant</option>
                <option value="SSG">SSG - Staff Sergeant</option>
                <option value="SFC">SFC - Sergeant First Class</option>
                <option value="MSG">MSG - Master Sergeant</option>
                <option value="SGM">SGM - Sergeant Major</option>
              </optgroup>
              <optgroup label="Officers">
                <option value="2LT">2LT - Second Lieutenant</option>
                <option value="1LT">1LT - First Lieutenant</option>
                <option value="CPT">CPT - Captain</option>
                <option value="MAJ">MAJ - Major</option>
                <option value="LTC">LTC - Lieutenant Colonel</option>
                <option value="COL">COL - Colonel</option>
                <option value="BG">BG - Brigadier General</option>
                <option value="MG">MG - Major General</option>
                <option value="LTG">LTG - Lieutenant General</option>
                <option value="GEN">GEN - General</option>
              </optgroup>
            </select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <button
            type="submit"
            disabled={!name.trim() || submitting || loading}
            className="btn-primary flex items-center justify-center py-3 px-6 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-5 w-5 mr-2" />
            {submitting ? 'Adding Personnel...' : 'Add Personnel'}
          </button>

          <button
            type="button"
            onClick={() => {
              setName('')
              setRank('SPC')
            }}
            disabled={submitting || loading}
            className="btn-secondary"
          >
            Clear Form
          </button>
        </div>

        <div className="text-sm text-military-muted">
          <p className="mb-1">• Initial ELO rating: 1000 points</p>
          <p className="mb-1">• Personnel will be available for rating immediately</p>
          <p>• Names must be unique within the system</p>
        </div>
      </form>
    </div>
  )
}
