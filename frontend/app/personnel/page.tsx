'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Users, Edit, Trash2, UserX, RotateCcw, AlertTriangle } from 'lucide-react'
import PersonnelForm from '@/components/PersonnelForm'

interface Personnel {
  id: number
  name: string
  rank: string
  current_elo: number
  initial_elo: number
  created_at: string
  active: boolean
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function PersonnelPage() {
  const [personnel, setPersonnel] = useState<Personnel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [editingPersonnel, setEditingPersonnel] = useState<Personnel | null>(null)
  const [editForm, setEditForm] = useState({ name: '', rank: '' })

  useEffect(() => {
    fetchPersonnel()
  }, [])

  const fetchPersonnel = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`${API_URL}/api/personnel?active_only=false`)

      if (!response.ok) {
        throw new Error('Failed to fetch personnel')
      }

      const data = await response.json()
      setPersonnel(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleAddPersonnel = async (name: string, rank: string) => {
    try {
      const response = await fetch(`${API_URL}/api/personnel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          rank,
          initial_elo: 1000
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to add personnel')
      }

      await fetchPersonnel()
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Failed to add personnel')
    }
  }

  const handleDeletePersonnel = async (id: number) => {
    try {
      const response = await fetch(`${API_URL}/api/personnel/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete personnel')
      }

      setDeleteConfirm(null)
      await fetchPersonnel()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete personnel')
    }
  }

  const handleEditPersonnel = async (id: number, name: string, rank: string) => {
    try {
      const response = await fetch(`${API_URL}/api/personnel/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          rank
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to update personnel')
      }

      setEditingPersonnel(null)
      setEditForm({ name: '', rank: '' })
      await fetchPersonnel()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update personnel')
    }
  }

  const startEdit = (person: Personnel) => {
    setEditingPersonnel(person)
    setEditForm({ name: person.name, rank: person.rank })
  }

  const cancelEdit = () => {
    setEditingPersonnel(null)
    setEditForm({ name: '', rank: '' })
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const formatEloChange = (current: number, initial: number) => {
    const change = current - initial
    if (change > 0) return `+${change}`
    if (change < 0) return change.toString()
    return '±0'
  }

  const getEloChangeColor = (current: number, initial: number) => {
    const change = current - initial
    if (change > 0) return 'text-military-green'
    if (change < 0) return 'text-military-red'
    return 'text-military-muted'
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="text-center">
          <Users className="h-12 w-12 text-military-green mx-auto mb-4 animate-pulse" />
          <h1 className="text-3xl font-bold font-mono text-military-light mb-2">
            LOADING PERSONNEL...
          </h1>
          <p className="text-military-muted">Retrieving personnel database</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-mono text-military-light mb-2">
            PERSONNEL MANAGEMENT
          </h1>
          <p className="text-military-muted">Manage personnel registry and ratings</p>
        </div>
        <Link href="/" className="btn-secondary">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Dashboard
        </Link>
      </div>

      {/* Error Display */}
      {error && (
        <div className="card bg-military-red/10 border-military-red">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 text-military-red mr-3" />
            <span className="text-military-red font-medium">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-military-red hover:text-red-400"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Add Personnel Form */}
      <PersonnelForm onSubmit={handleAddPersonnel} loading={loading} />

      {/* Personnel List */}
      <div className="card">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold font-mono text-military-light mb-2">
              PERSONNEL ROSTER
            </h2>
            <p className="text-military-muted">
              {personnel.filter(p => p.active).length} active personnel
              {personnel.filter(p => !p.active).length > 0 &&
                ` • ${personnel.filter(p => !p.active).length} inactive`
              }
            </p>
          </div>
          <button
            onClick={fetchPersonnel}
            className="btn-secondary"
            disabled={loading}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Refresh
          </button>
        </div>

        {personnel.length === 0 ? (
          <div className="text-center py-12">
            <Users className="h-12 w-12 text-military-muted mx-auto mb-4" />
            <h3 className="text-xl font-bold font-mono text-military-light mb-2">
              NO PERSONNEL REGISTERED
            </h3>
            <p className="text-military-muted">
              Add personnel using the form above to begin evaluations
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-military-gray">
                  <th className="text-left py-3 px-2 font-mono text-military-muted">NAME</th>
                  <th className="text-left py-3 px-2 font-mono text-military-muted">RANK</th>
                  <th className="text-right py-3 px-2 font-mono text-military-muted">ELO</th>
                  <th className="text-right py-3 px-2 font-mono text-military-muted">CHANGE</th>
                  <th className="text-center py-3 px-2 font-mono text-military-muted">ADDED</th>
                  <th className="text-center py-3 px-2 font-mono text-military-muted">STATUS</th>
                  <th className="text-center py-3 px-2 font-mono text-military-muted">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {personnel.map((person) => (
                  <tr key={person.id} className="table-row">
                    <td className="py-3 px-2">
                      {editingPersonnel?.id === person.id ? (
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                          className="input-field w-full text-sm"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleEditPersonnel(person.id, editForm.name, editForm.rank)
                            } else if (e.key === 'Escape') {
                              cancelEdit()
                            }
                          }}
                        />
                      ) : (
                        <span className={`font-medium ${!person.active ? 'text-military-muted line-through' : ''}`}>
                          {person.name}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      {editingPersonnel?.id === person.id ? (
                        <select
                          value={editForm.rank}
                          onChange={(e) => setEditForm(prev => ({ ...prev, rank: e.target.value }))}
                          className="input-field w-full text-sm"
                        >
                          <option value="PVT">PVT</option>
                          <option value="PFC">PFC</option>
                          <option value="SPC">SPC</option>
                          <option value="CPL">CPL</option>
                          <option value="SGT">SGT</option>
                          <option value="SSG">SSG</option>
                          <option value="SFC">SFC</option>
                          <option value="MSG">MSG</option>
                          <option value="SGM">SGM</option>
                          <option value="2LT">2LT</option>
                          <option value="1LT">1LT</option>
                          <option value="CPT">CPT</option>
                          <option value="MAJ">MAJ</option>
                          <option value="LTC">LTC</option>
                          <option value="COL">COL</option>
                          <option value="BG">BG</option>
                          <option value="MG">MG</option>
                          <option value="LTG">LTG</option>
                          <option value="GEN">GEN</option>
                        </select>
                      ) : (
                        <span className="font-mono text-military-muted">
                          {person.rank}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-right font-mono font-bold">
                      {person.current_elo.toLocaleString()}
                    </td>
                    <td className={`py-3 px-2 text-right font-mono font-bold ${getEloChangeColor(person.current_elo, person.initial_elo)}`}>
                      {formatEloChange(person.current_elo, person.initial_elo)}
                    </td>
                    <td className="py-3 px-2 text-center text-military-muted text-sm font-mono">
                      {formatDate(person.created_at)}
                    </td>
                    <td className="py-3 px-2 text-center">
                      {person.active ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-mono bg-military-green/20 text-military-green">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-mono bg-military-red/20 text-military-red">
                          <UserX className="h-3 w-3 mr-1" />
                          INACTIVE
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-center">
                      {editingPersonnel?.id === person.id ? (
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={() => handleEditPersonnel(person.id, editForm.name, editForm.rank)}
                            className="text-military-green hover:text-green-400 p-1"
                            title="Save changes"
                          >
                            ✓
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-military-red hover:text-red-400 p-1"
                            title="Cancel"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={() => startEdit(person)}
                            className="text-military-muted hover:text-military-light p-1"
                            title="Edit personnel"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          {deleteConfirm === person.id ? (
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={() => handleDeletePersonnel(person.id)}
                                className="text-military-red hover:text-red-400 p-1 text-xs"
                                title="Confirm delete"
                              >
                                ✓
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="text-military-muted hover:text-military-light p-1 text-xs"
                                title="Cancel"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(person.id)}
                              className="text-military-muted hover:text-military-red p-1"
                              title="Delete personnel"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      {personnel.filter(p => p.active).length >= 2 && (
        <div className="text-center">
          <Link href="/rate" className="btn-primary inline-flex items-center py-3 px-6 text-lg">
            <Users className="h-5 w-5 mr-2" />
            Start Rating Session
          </Link>
        </div>
      )}
    </div>
  )
}
