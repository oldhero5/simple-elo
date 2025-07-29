'use client'

import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { format } from 'date-fns'

interface EloDataPoint {
  personnel_id: number
  name: string
  rank: string
  rated_at: string
  elo_score: number
}

interface RoundDataPoint {
  personnel_id: number
  name: string
  rank: string
  round_name: string
  round_number: number
  elo_score: number
  round_dtg: string
}

interface ProcessedDataPoint {
  date: string
  timestamp: number
  [key: string]: any
}

interface EloChartProps {
  data: EloDataPoint[]
}

const colors = [
  '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6',
  '#f97316', '#06b6d4', '#84cc16', '#f43f5e', '#6366f1'
]

export default function EloChart({ data }: EloChartProps) {
  const [viewMode, setViewMode] = useState<'matchup' | 'round'>('round')
  const [roundData, setRoundData] = useState<RoundDataPoint[]>([])
  const [loading, setLoading] = useState(false)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  // Fetch round-based data when view mode changes to 'round' or on initial load
  useEffect(() => {
    if (viewMode === 'round') {
      fetchRoundData()
    }
  }, [viewMode])

  // Fetch round data on initial load since default is 'round'
  useEffect(() => {
    fetchRoundData()
  }, [])

  const fetchRoundData = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${API_URL}/api/elo-progression/by-rounds`)
      if (response.ok) {
        const data = await response.json()
        setRoundData(data)
      }
    } catch (error) {
      console.error('Failed to fetch round data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (roundData.length === 0 && viewMode === 'round' && !loading) {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="text-center">
          <div className="text-military-muted font-mono text-lg mb-2">NO ROUNDS COMPLETED</div>
          <p className="text-military-muted text-sm">Complete at least one round to see round-based progression</p>
        </div>
      </div>
    )
  }

  if ((!data || data.length === 0) && viewMode === 'matchup') {
    return (
      <div className="card h-96 flex items-center justify-center">
        <div className="text-center">
          <div className="text-military-muted font-mono text-lg mb-2">NO DATA AVAILABLE</div>
          <p className="text-military-muted text-sm">Complete some ratings to see ELO progression</p>
        </div>
      </div>
    )
  }

  // Process data for chart based on view mode
  const processedData: ProcessedDataPoint[] = []
  let personnelKeys: string[] = []

  if (viewMode === 'matchup' && data && data.length > 0) {
    // Existing matchup-based processing
    const personnelData: { [key: number]: EloDataPoint[] } = {}

    // Group data by personnel
    data.forEach(point => {
      if (!personnelData[point.personnel_id]) {
        personnelData[point.personnel_id] = []
      }
      personnelData[point.personnel_id].push(point)
    })

    // Sort each personnel's data by date
    Object.keys(personnelData).forEach(id => {
      personnelData[parseInt(id)].sort((a, b) =>
        new Date(a.rated_at).getTime() - new Date(b.rated_at).getTime()
      )
    })

    // Create timeline of all rating events
    const allEvents = data
      .map(point => ({
        ...point,
        timestamp: new Date(point.rated_at).getTime()
      }))
      .sort((a, b) => a.timestamp - b.timestamp)

    // Build chart data points
    const personnelCurrentScores: { [key: number]: number } = {}

    // Initialize with starting scores (1000)
    Object.keys(personnelData).forEach(id => {
      personnelCurrentScores[parseInt(id)] = 1000
    })

    allEvents.forEach(event => {
      // Update the score for this personnel
      personnelCurrentScores[event.personnel_id] = event.elo_score

      // Create data point with all current scores
      const dataPoint: ProcessedDataPoint = {
        date: format(new Date(event.rated_at), 'MMM dd HH:mm'),
        timestamp: event.timestamp
      }

      Object.keys(personnelCurrentScores).forEach(id => {
        const personnel = personnelData[parseInt(id)][0]
        dataPoint[`${personnel.rank} ${personnel.name}`] = personnelCurrentScores[parseInt(id)]
      })

      processedData.push(dataPoint)
    })

    personnelKeys = Object.keys(personnelData).map(id => {
      const personnel = personnelData[parseInt(id)][0]
      return `${personnel.rank} ${personnel.name}`
    })
  } else if (viewMode === 'round' && roundData.length > 0) {
    // Round-based processing
    const personnelRoundData: { [key: number]: RoundDataPoint[] } = {}

    // Group round data by personnel
    roundData.forEach(point => {
      if (!personnelRoundData[point.personnel_id]) {
        personnelRoundData[point.personnel_id] = []
      }
      personnelRoundData[point.personnel_id].push(point)
    })

    // Sort each personnel's data by round number
    Object.keys(personnelRoundData).forEach(id => {
      personnelRoundData[parseInt(id)].sort((a, b) => a.round_number - b.round_number)
    })

    // Get all unique round numbers
    const roundNumbers = Array.from(new Set(roundData.map(p => p.round_number))).sort((a, b) => a - b)

    // Build chart data points for each round
    roundNumbers.forEach(roundNum => {
      const roundPoints = roundData.filter(p => p.round_number === roundNum)
      if (roundPoints.length > 0) {
        const dataPoint: ProcessedDataPoint = {
          date: roundNum === 0 ? 'Starting' : `Round ${roundNum}`,
          timestamp: roundNum
        }

        roundPoints.forEach(point => {
          dataPoint[`${point.rank} ${point.name}`] = point.elo_score
        })

        processedData.push(dataPoint)
      }
    })

    // Get personnel keys from round data
    const uniquePersonnel = roundData.reduce((acc, point) => {
      const key = `${point.rank} ${point.name}`
      if (!acc.includes(key)) {
        acc.push(key)
      }
      return acc
    }, [] as string[])

    personnelKeys = uniquePersonnel
  }

  return (
    <div className="card">
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold font-mono text-military-light mb-2">
              ELO PROGRESSION
            </h2>
            <p className="text-military-muted">
              {viewMode === 'matchup' ? 'Performance ratings per matchup' : 'Performance ratings per completed round'}
            </p>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center space-x-4 mt-4 sm:mt-0">
            <span className="text-military-muted text-sm font-mono">VIEW:</span>
            <div className="flex items-center space-x-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="viewMode"
                  value="matchup"
                  checked={viewMode === 'matchup'}
                  onChange={(e) => setViewMode(e.target.value as 'matchup' | 'round')}
                  className="sr-only"
                />
                <div className={`w-4 h-4 rounded-full border-2 mr-2 ${
                  viewMode === 'matchup'
                    ? 'border-military-green bg-military-green'
                    : 'border-military-gray'
                }`}>
                  {viewMode === 'matchup' && (
                    <div className="w-2 h-2 bg-military-dark rounded-full m-0.5"></div>
                  )}
                </div>
                <span className={`text-sm font-mono ${
                  viewMode === 'matchup' ? 'text-military-light' : 'text-military-muted'
                }`}>
                  Per Matchup
                </span>
              </label>

              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="viewMode"
                  value="round"
                  checked={viewMode === 'round'}
                  onChange={(e) => setViewMode(e.target.value as 'matchup' | 'round')}
                  className="sr-only"
                />
                <div className={`w-4 h-4 rounded-full border-2 mr-2 ${
                  viewMode === 'round'
                    ? 'border-military-green bg-military-green'
                    : 'border-military-gray'
                }`}>
                  {viewMode === 'round' && (
                    <div className="w-2 h-2 bg-military-dark rounded-full m-0.5"></div>
                  )}
                </div>
                <span className={`text-sm font-mono ${
                  viewMode === 'round' ? 'text-military-light' : 'text-military-muted'
                }`}>
                  Per Round
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="h-96">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-military-muted font-mono">Loading round data...</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={processedData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis
                dataKey="date"
                stroke="#a3a3a3"
                fontSize={12}
                fontFamily="JetBrains Mono"
              />
              <YAxis
                stroke="#a3a3a3"
                fontSize={12}
                fontFamily="JetBrains Mono"
                domain={['dataMin - 50', 'dataMax + 50']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #2a2a2a',
                  borderRadius: '8px',
                  color: '#e5e5e5',
                  fontFamily: 'JetBrains Mono',
                  fontSize: '12px'
                }}
                labelStyle={{ color: '#a3a3a3' }}
              />
              <Legend
                wrapperStyle={{
                  color: '#a3a3a3',
                  fontFamily: 'JetBrains Mono',
                  fontSize: '12px'
                }}
              />
              {personnelKeys.map((key, index) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={colors[index % colors.length]}
                  strokeWidth={2}
                  dot={{ fill: colors[index % colors.length], strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, stroke: colors[index % colors.length], strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
