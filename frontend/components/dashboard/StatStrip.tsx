import { Stat, StatList } from '@/components/ui'
import { formatCount, formatPerson, formatRating } from '@/lib/format'
import type { LeaderboardEntry, Stats } from '@/lib/types'

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`
}

function leaderHint(leaderboard: readonly LeaderboardEntry[]): string {
  const top = leaderboard[0].current_elo
  const tied = leaderboard.filter((person) => person.current_elo === top).length - 1
  return tied > 0
    ? `${formatRating(top)}, tied with ${plural(tied, 'other', 'others')}`
    : formatRating(top)
}

export interface StatStripProps {
  stats: Stats
  /** Highest rating first, as /api/leaderboard returns it. */
  leaderboard: readonly LeaderboardEntry[]
}

/** People, votes, current round and leader, as one divided <dl>. */
export function StatStrip({ stats, leaderboard }: StatStripProps) {
  const round = stats.current_round
  // Before the first vote everyone is still on their starting rating, so
  // naming a leader would just pick whoever sorts first.
  const leader = stats.total_ratings > 0 ? leaderboard[0] : undefined

  return (
    <StatList columns={4}>
      <Stat label="People" value={formatCount(stats.total_personnel)} />
      <Stat label="Votes" value={formatCount(stats.total_ratings)} />
      <Stat
        label="Current round"
        value={
          round ? (
            <>
              <span aria-hidden="true">
                {formatCount(round.progress.completed)} / {formatCount(round.progress.total)}
              </span>
              <span className="sr-only">
                {round.progress.completed} of {round.progress.total} rated
              </span>
            </>
          ) : (
            'None'
          )
        }
        hint={
          round
            ? round.name
            : stats.completed_rounds > 0
              ? `${plural(stats.completed_rounds, 'round', 'rounds')} completed`
              : undefined
        }
      />
      <Stat
        label="Leader"
        value={leader ? formatPerson(leader) : 'None'}
        hint={leader ? leaderHint(leaderboard) : undefined}
      />
    </StatList>
  )
}
