'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Trophy, Users, Target, TrendingUp, Activity } from 'lucide-react'
import EloChart from '@/components/EloChart'

interface Personnel {
  id: number
  name: string
  rank: string
  current_elo: number
  initial_elo: number
  created_at: string
  active: boolean
}

interface EloDataPoint {
  personnel_id: number
  name: string
  rank: string
  rated_at: string
  elo_score: number
}

interface Stats {
  total_personnel: number
  total_ratings: number
  avg_elo: number
  highest_elo: number
  lowest_elo: number
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function Dashboard() {
  const [personnel, setPersonnel] = useState<Personnel[]>([])
  const [eloData, setEloData] = useState<EloDataPoint[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)

      const [personnelRes, eloRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/personnel`),
        fetch(`${API_URL}/api/elo-progression`),
        fetch(`${API_URL}/api/stats`)
      ])

      if (!personnelRes.ok || !eloRes.ok || !statsRes.ok) {
        throw new Error('Failed to fetch data')
      }

      const [personnelData, eloProgression, statsData] = await Promise.all([
        personnelRes.json(),
        eloRes.json(),
        statsRes.json()
      ])

      setPersonnel(personnelData)
      setEloData(eloProgression)
      setStats(statsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const formatElo = (elo: number) => {
    return elo.toLocaleString('en-US')
  }

  const getEloChangeColor = (current: number, initial: number) => {
    const change = current - initial
    if (change > 0) return 'text-military-green'
    if (change < 0) return 'text-military-red'
    return 'text-military-muted'
  }

  const getEloChangeText = (current: number, initial: number) => {
    const change = current - initial
    if (change > 0) return `+${change}`
    return change.toString()
  }

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="text-center">
          <Activity className="h-12 w-12 text-military-green mx-auto mb-4 animate-pulse" />
          <h1 className="text-3xl font-bold font-mono text-military-light mb-2">
            LOADING SYSTEM DATA...
          </h1>
          <p className="text-military-muted">Initializing ELO rating platform</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center">
        <div className="card max-w-md mx-auto">
          <div className="text-military-red text-6xl font-mono mb-4">ERROR</div>
          <p className="text-military-muted mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="btn-primary"
          >
            Retry Connection
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold font-mono text-military-light mb-2">
          ELO PERFORMANCE RATING SYSTEM
        </h1>
        <p className="text-military-muted text-lg">
          Military-Grade Personnel Evaluation Platform
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="card text-center">
            <Users className="h-8 w-8 text-military-green mx-auto mb-2" />
            <div className="text-2xl font-bold font-mono text-military-light">
              {stats.total_personnel}
            </div>
            <div className="text-military-muted text-sm">Active Personnel</div>
          </div>

          <div className="card text-center">
            <Target className="h-8 w-8 text-military-amber mx-auto mb-2" />
            <div className="text-2xl font-bold font-mono text-military-light">
              {stats.total_ratings}
            </div>
            <div className="text-military-muted text-sm">Total Ratings</div>
          </div>

          <div className="card text-center">
            <TrendingUp className="h-8 w-8 text-military-green mx-auto mb-2" />
            <div className="text-2xl font-bold font-mono text-military-light">
              {formatElo(Math.round(stats.avg_elo))}
            </div>
            <div className="text-military-muted text-sm">Average ELO</div>
          </div>

          <div className="card text-center">
            <Trophy className="h-8 w-8 text-military-amber mx-auto mb-2" />
            <div className="text-2xl font-bold font-mono text-military-light">
              {formatElo(stats.highest_elo)}
            </div>
            <div className="text-military-muted text-sm">Highest ELO</div>
          </div>
        </div>
      )}

      {/* ELO Progression Chart */}
      <EloChart data={eloData} />

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Link href="/rate" className="btn-primary text-center py-4 px-8 text-lg">
          <Target className="h-6 w-6 inline mr-2" />
          Start Rating Session
        </Link>
        <Link href="/personnel" className="btn-secondary text-center py-4 px-8 text-lg">
          <Users className="h-6 w-6 inline mr-2" />
          Manage Personnel
        </Link>
      </div>

      {/* Current Leaderboard */}
      {personnel.length > 0 && (
        <div className="card">
          <div className="mb-6">
            <h2 className="text-2xl font-bold font-mono text-military-light mb-2">
              CURRENT LEADERBOARD
            </h2>
            <p className="text-military-muted">Top performers by ELO rating</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-military-gray">
                  <th className="text-left py-3 px-2 font-mono text-military-muted">RANK</th>
                  <th className="text-left py-3 px-2 font-mono text-military-muted">NAME</th>
                  <th className="text-left py-3 px-2 font-mono text-military-muted">POSITION</th>
                  <th className="text-right py-3 px-2 font-mono text-military-muted">ELO</th>
                  <th className="text-right py-3 px-2 font-mono text-military-muted">CHANGE</th>
                </tr>
              </thead>
              <tbody>
                {personnel.slice(0, 10).map((person, index) => (
                  <tr key={person.id} className="table-row">
                    <td className="py-3 px-2">
                      <div className="flex items-center">
                        {index === 0 && (
                          <Trophy className="h-4 w-4 text-military-amber mr-2" />
                        )}
                        <span className="font-mono font-bold">
                          #{index + 1}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2 font-medium">{person.name}</td>
                    <td className="py-3 px-2 text-military-muted font-mono">
                      {person.rank}
                    </td>
                    <td className="py-3 px-2 text-right font-mono font-bold">
                      {formatElo(person.current_elo)}
                    </td>
                    <td className={`py-3 px-2 text-right font-mono font-bold ${getEloChangeColor(person.current_elo, person.initial_elo)}`}>
                      {getEloChangeText(person.current_elo, person.initial_elo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {personnel.length === 0 && (
        <div className="card text-center">
          <Users className="h-12 w-12 text-military-muted mx-auto mb-4" />
          <h3 className="text-xl font-bold font-mono text-military-light mb-2">
            NO PERSONNEL REGISTERED
          </h3>
          <p className="text-military-muted mb-4">
            Add personnel to begin conducting performance evaluations
          </p>
          <Link href="/personnel" className="btn-primary">
            Add Personnel
          </Link>
        </div>
      )}
    </div>
  )
}
