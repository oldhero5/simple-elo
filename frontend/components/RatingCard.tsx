'use client'

interface Personnel {
  id: number
  name: string
  rank: string
  current_elo: number
  initial_elo: number
  created_at: string
  active: boolean
}

interface RatingCardProps {
  person: Personnel
  expectedScore: number
  onSelect: () => void
  disabled?: boolean
  variant?: 'default' | 'winner'
}

export default function RatingCard({
  person,
  expectedScore,
  onSelect,
  disabled = false,
  variant = 'default'
}: RatingCardProps) {
  const cardClass = variant === 'winner'
    ? 'card border-military-green bg-military-green/10 cursor-pointer transform hover:scale-105 transition-all duration-200'
    : 'card cursor-pointer hover:border-military-green/50 transform hover:scale-105 transition-all duration-200'

  return (
    <div
      className={`${cardClass} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      onClick={disabled ? undefined : onSelect}
    >
      <div className="text-center">
        <div className="mb-4">
          <div className="text-2xl font-bold font-mono text-military-light mb-1">
            {person.rank}
          </div>
          <div className="text-3xl font-bold text-military-light mb-2">
            {person.name}
          </div>
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-military-gray">
            <span className="text-sm font-mono text-military-light">
              ELO: {person.current_elo.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="border-t border-military-gray pt-3">
            <div className="text-sm text-military-muted mb-1">Expected Win Probability</div>
            <div className="text-xl font-bold font-mono text-military-green">
              {(expectedScore * 100).toFixed(1)}%
            </div>
          </div>

          <div className="text-sm text-military-muted">
            Click to select as winner
          </div>
        </div>
      </div>
    </div>
  )
}
