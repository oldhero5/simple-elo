'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Target, RotateCcw, Users, Trophy, Minus, TrendingUp } from 'lucide-react'
import RatingCard from '@/components/RatingCard'

interface Personnel {
  id: number
  name: string
  rank: string
  current_elo: number
  initial_elo: number
  created_at: string
  active: boolean
}

interface Round {
  id: number
  round_name: string
  dtg: string
  status: string
  total_matchups: number
  completed_matchups: number
  personnel_snapshot: string
  created_at: string
}

interface Matchup {
  id: number
  round_id: number
  ratee_a_id: number
  ratee_b_id: number
  status: string
  created_at: string
}

interface ComparisonPair {
  round_info: Round
  matchup: Matchup
  person_a: Personnel
  person_b: Personnel
  expected_scores: {
    a_expected: number
    b_expected: number
  }
  rating_preview: {
    a_wins: {
      a_new: number
      b_new: number
      a_change: number
      b_change: number
    }
    b_wins: {
      a_new: number
      b_new: number
      a_change: number
      b_change: number
    }
    draw: {
      a_new: number
      b_new: number
      a_change: number
      b_change: number
    }
  }
  progress: {
    total_matchups: number
    completed_matchups: number
    remaining_matchups: number
    completion_percentage: number
    status: string
  }
}

interface RoundResults {
  round: Round
  leaderboard: Array<{
    id: number
    name: string
    rank: string
    starting_elo: number
    final_elo: number
    elo_change: number
  }>
  statistics: {
    total_ratings: number
    biggest_elo_gain: number
    biggest_elo_loss: number
    total_personnel: number
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function RatePage() {
  const [comparison, setComparison] = useState<ComparisonPair | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [ratingsCompleted, setRatingsCompleted] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [sessionActive, setSessionActive] = useState(false)
  const [roundComplete, setRoundComplete] = useState(false)
  const [roundResults, setRoundResults] = useState<RoundResults | null>(null)
  const [completedRoundId, setCompletedRoundId] = useState<number | null>(null)

  useEffect(() => {
    fetchComparison()
    setSessionActive(true)
  }, [])

  const fetchComparison = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`${API_URL}/api/comparison/full`)

      if (!response.ok) {
        if (response.status === 404) {
          // Round is complete or no round exists - try to fetch completed round results
          console.log('No matchups available, fetching round results...')
          await fetchCompletedRoundResults()
          return
        }
        throw new Error('Failed to fetch comparison data')
      }

      const data = await response.json()
      setComparison(data)
      setRoundComplete(false)
      setRoundResults(null)
    } catch (err) {
      console.error('Error in fetchComparison:', err)
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const fetchCompletedRoundResults = async () => {
    try {
      console.log('Fetching completed rounds...')
      // First get the list of completed rounds
      const roundsResponse = await fetch(`${API_URL}/api/rounds/completed`)
      if (!roundsResponse.ok) {
        throw new Error('Failed to fetch completed rounds')
      }

      const completedRounds = await roundsResponse.json()
      console.log('Completed rounds:', completedRounds)

      if (completedRounds.length === 0) {
        // No completed rounds - this means no rounds have been started yet
        console.log('No completed rounds found')
        setError('No rounds have been started yet. Click "Start New Round" to begin.')
        setRoundComplete(true)
        setComparison(null)
        setLoading(false)
        return
      }

      // Get the most recent completed round
      const latestRound = completedRounds[0]
      console.log('Latest completed round:', latestRound)
      setCompletedRoundId(latestRound.id)

      // Fetch detailed results for this round
      const resultsResponse = await fetch(`${API_URL}/api/rounds/${latestRound.id}/results`)
      if (!resultsResponse.ok) {
        throw new Error('Failed to fetch round results')
      }

      const results = await resultsResponse.json()
      console.log('Round results:', results)
      setRoundResults(results)
      setRoundComplete(true)
      setComparison(null)
      setError(null) // Clear any existing errors
      setLoading(false)
    } catch (err) {
      console.error('Error in fetchCompletedRoundResults:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch round results')
      setRoundComplete(true)
      setComparison(null)
      setLoading(false)
    }
  }

  const submitRating = async (winnerId: number | null) => {
    if (!comparison) return

    try {
      setSubmitting(true)

      const response = await fetch(`${API_URL}/api/rate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          round_id: comparison.round_info.id,
          matchup_id: comparison.matchup.id,
          ratee_a_id: comparison.person_a.id,
          ratee_b_id: comparison.person_b.id,
          winner_id: winnerId,
          rater_id: null
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to submit rating')
      }

      setRatingsCompleted(prev => prev + 1)

      // Fetch next comparison
      await fetchComparison()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit rating')
    } finally {
      setSubmitting(false)
    }
  }

  const handlePersonAWins = () => {
    if (comparison) {
      submitRating(comparison.person_a.id)
    }
  }

  const handlePersonBWins = () => {
    if (comparison) {
      submitRating(comparison.person_b.id)
    }
  }

  const handleDraw = () => {
    submitRating(null)
  }

  const formatEloChange = (change: number) => {
    return change > 0 ? `+${change}` : change.toString()
  }

  const getChangeColor = (change: number) => {
    if (change > 0) return 'text-military-green'
    if (change < 0) return 'text-military-red'
    return 'text-military-muted'
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card text-center">
          <Target className="h-12 w-12 text-military-red mx-auto mb-4" />
          <h1 className="text-2xl font-bold font-mono text-military-light mb-4">
            RATING SESSION ERROR
          </h1>
          <p className="text-military-muted mb-6">{error}</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {error.includes('No rounds have been started yet') ? (
              <button
                onClick={async () => {
                  try {
                    const response = await fetch(`${API_URL}/api/rounds/new`, {
                      method: 'POST'
                    })
                    if (response.ok) {
                      setError(null)
                      await fetchComparison()
                    } else {
                      setError('Failed to start new round')
                    }
                  } catch (err) {
                    setError('Failed to start new round')
                  }
                }}
                className="btn-primary"
              >
                <Target className="h-4 w-4 mr-2" />
                Start New Round
              </button>
            ) : (
              <button
                onClick={fetchComparison}
                className="btn-primary"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Try Again
              </button>
            )}
            <Link href="/" className="btn-secondary">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Link>
            <Link href="/personnel" className="btn-secondary">
              <Users className="h-4 w-4 mr-2" />
              Manage Personnel
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <Target className="h-12 w-12 text-military-green mx-auto mb-4 animate-pulse" />
          <h1 className="text-3xl font-bold font-mono text-military-light mb-2">
            LOADING COMPARISON...
          </h1>
          <p className="text-military-muted">Preparing rating session</p>
        </div>
      </div>
    )
  }

  if (roundComplete) {
    return (
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center">
          <Trophy className="h-12 w-12 text-military-green mx-auto mb-4" />
          <h1 className="text-3xl font-bold font-mono text-military-light mb-2">
            ROUND COMPLETE!
          </h1>
          {roundResults && (
            <div className="space-y-2">
              <p className="text-military-amber text-lg font-mono">
                {roundResults.round.round_name}
              </p>
              <p className="text-military-muted">
                Completed at: {new Date(roundResults.round.dtg).toLocaleString()}
              </p>
            </div>
          )}
        </div>

        {/* Round Statistics */}
        {roundResults && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="card text-center">
              <Target className="h-8 w-8 text-military-amber mx-auto mb-2" />
              <div className="text-2xl font-bold font-mono text-military-light">
                {roundResults.statistics.total_ratings}
              </div>
              <div className="text-military-muted text-sm">Total Ratings</div>
            </div>

            <div className="card text-center">
              <Users className="h-8 w-8 text-military-green mx-auto mb-2" />
              <div className="text-2xl font-bold font-mono text-military-light">
                {roundResults.statistics.total_personnel}
              </div>
              <div className="text-military-muted text-sm">Personnel</div>
            </div>

            <div className="card text-center">
              <TrendingUp className="h-8 w-8 text-military-green mx-auto mb-2" />
              <div className="text-2xl font-bold font-mono text-military-green">
                +{roundResults.statistics.biggest_elo_gain}
              </div>
              <div className="text-military-muted text-sm">Biggest Gain</div>
            </div>

            <div className="card text-center">
              <div className="h-8 w-8 text-military-red mx-auto mb-2 flex items-center justify-center">
                <TrendingUp className="h-8 w-8 transform rotate-180" />
              </div>
              <div className="text-2xl font-bold font-mono text-military-red">
                {roundResults.statistics.biggest_elo_loss}
              </div>
              <div className="text-military-muted text-sm">Biggest Loss</div>
            </div>
          </div>
        )}

        {/* Final Leaderboard */}
        {roundResults && (
          <div className="card">
            <div className="mb-6">
              <h2 className="text-2xl font-bold font-mono text-military-light mb-2">
                FINAL ROUND STANDINGS
              </h2>
              <p className="text-military-muted">ELO ratings at round completion</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-military-gray">
                    <th className="text-left py-3 px-2 font-mono text-military-muted">RANK</th>
                    <th className="text-left py-3 px-2 font-mono text-military-muted">NAME</th>
                    <th className="text-left py-3 px-2 font-mono text-military-muted">POSITION</th>
                    <th className="text-right py-3 px-2 font-mono text-military-muted">STARTING</th>
                    <th className="text-right py-3 px-2 font-mono text-military-muted">FINAL</th>
                    <th className="text-right py-3 px-2 font-mono text-military-muted">CHANGE</th>
                  </tr>
                </thead>
                <tbody>
                  {roundResults.leaderboard.map((person, index) => (
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
                      <td className="py-3 px-2 text-right font-mono">
                        {person.starting_elo.toLocaleString()}
                      </td>
                      <td className="py-3 px-2 text-right font-mono font-bold">
                        {person.final_elo.toLocaleString()}
                      </td>
                      <td className={`py-3 px-2 text-right font-mono font-bold ${
                        person.elo_change > 0 ? 'text-military-green' :
                        person.elo_change < 0 ? 'text-military-red' : 'text-military-muted'
                      }`}>
                        {person.elo_change > 0 ? '+' : ''}{person.elo_change}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/" className="btn-secondary">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Link>
          <button
            onClick={async () => {
              try {
                const response = await fetch(`${API_URL}/api/rounds/new`, {
                  method: 'POST'
                })
                if (response.ok) {
                  setRoundComplete(false)
                  setRatingsCompleted(0)
                  setRoundResults(null)
                  setCompletedRoundId(null)
                  await fetchComparison()
                }
              } catch (err) {
                setError('Failed to start new round')
              }
            }}
            className="btn-primary"
          >
            <Target className="h-4 w-4 mr-2" />
            Start New Round
          </button>
        </div>
      </div>
    )
  }

  if (!comparison) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card text-center">
          <Users className="h-12 w-12 text-military-muted mx-auto mb-4" />
          <h1 className="text-2xl font-bold font-mono text-military-light mb-4">
            NO COMPARISON AVAILABLE
          </h1>
          <p className="text-military-muted mb-6">
            Unable to generate comparison pair
          </p>
          <Link href="/" className="btn-primary">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="flex items-center justify-center mb-4">
          <Target className="h-8 w-8 text-military-green mr-3" />
          <h1 className="text-3xl font-bold font-mono text-military-light">
            RATING SESSION
          </h1>
        </div>
        <p className="text-military-muted text-lg mb-2">
          Select the superior performer or declare a draw
        </p>
        {sessionActive && comparison && (
          <div className="space-y-2">
            <div className="inline-flex items-center px-4 py-2 bg-military-dark border border-military-gray rounded-lg">
              <Trophy className="h-4 w-4 text-military-amber mr-2" />
              <span className="font-mono text-military-light">
                Round Progress: {comparison.progress.completed_matchups}/{comparison.progress.total_matchups}
              </span>
            </div>
            <div className="text-sm text-military-muted">
              <span className="font-mono">{comparison.round_info.round_name}</span>
              {comparison.progress.completion_percentage > 0 && (
                <span className="ml-2">({Math.round(comparison.progress.completion_percentage)}% complete)</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ELO Change Preview */}
      <div className="card mb-8 bg-military-dark/50">
        <h3 className="text-lg font-bold font-mono text-military-light mb-4 text-center">
          RATING CHANGE PREVIEW
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
          <div className="space-y-2">
            <div className="text-military-green font-mono font-bold">
              {comparison.person_a.rank} {comparison.person_a.name} WINS
            </div>
            <div className="text-sm space-y-1">
              <div className={`font-mono ${getChangeColor(comparison.rating_preview.a_wins.a_change)}`}>
                {comparison.person_a.name}: {formatEloChange(comparison.rating_preview.a_wins.a_change)}
              </div>
              <div className={`font-mono ${getChangeColor(comparison.rating_preview.a_wins.b_change)}`}>
                {comparison.person_b.name}: {formatEloChange(comparison.rating_preview.a_wins.b_change)}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-military-amber font-mono font-bold">
              DRAW
            </div>
            <div className="text-sm space-y-1">
              <div className={`font-mono ${getChangeColor(comparison.rating_preview.draw.a_change)}`}>
                {comparison.person_a.name}: {formatEloChange(comparison.rating_preview.draw.a_change)}
              </div>
              <div className={`font-mono ${getChangeColor(comparison.rating_preview.draw.b_change)}`}>
                {comparison.person_b.name}: {formatEloChange(comparison.rating_preview.draw.b_change)}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-military-green font-mono font-bold">
              {comparison.person_b.rank} {comparison.person_b.name} WINS
            </div>
            <div className="text-sm space-y-1">
              <div className={`font-mono ${getChangeColor(comparison.rating_preview.b_wins.a_change)}`}>
                {comparison.person_a.name}: {formatEloChange(comparison.rating_preview.b_wins.a_change)}
              </div>
              <div className={`font-mono ${getChangeColor(comparison.rating_preview.b_wins.b_change)}`}>
                {comparison.person_b.name}: {formatEloChange(comparison.rating_preview.b_wins.b_change)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Comparison Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        <RatingCard
          person={comparison.person_a}
          expectedScore={comparison.expected_scores.a_expected}
          onSelect={handlePersonAWins}
          disabled={submitting}
        />

        <RatingCard
          person={comparison.person_b}
          expectedScore={comparison.expected_scores.b_expected}
          onSelect={handlePersonBWins}
          disabled={submitting}
        />
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
        <button
          onClick={handleDraw}
          disabled={submitting}
          className="btn-secondary flex items-center justify-center py-3 px-6 text-lg"
        >
          <Minus className="h-5 w-5 mr-2" />
          {submitting ? 'Submitting...' : 'Declare Draw'}
        </button>

        <button
          onClick={fetchComparison}
          disabled={submitting}
          className="btn-secondary flex items-center justify-center py-3 px-6"
        >
          <RotateCcw className="h-5 w-5 mr-2" />
          Skip Comparison
        </button>
      </div>

      {/* Navigation */}
      <div className="text-center">
        <Link href="/" className="btn-secondary">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
