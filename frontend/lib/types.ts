/**
 * Types for the backend HTTP API (see backend/schemas.py). Field names match
 * the JSON exactly. Timestamps are ISO 8601 strings in UTC with a `Z` suffix;
 * format them with the helpers in lib/format.ts.
 */

/** ISO 8601 timestamp in UTC, for example "2026-11-07T14:22:05.120Z". */
export type IsoDateTime = string

export interface Health {
  status: 'ok'
}

export interface Personnel {
  id: number
  name: string
  rank: string
  initial_elo: number
  current_elo: number
  created_at: IsoDateTime
  active: boolean
}

export interface PersonnelCreate {
  name: string
  rank: string
  /** Integer 100..3000. Omit to start at 1000. */
  initial_elo?: number
}

export interface PersonnelUpdate {
  name?: string
  rank?: string
  /** false cancels the person's pending matchups in the active round. */
  active?: boolean
}

export interface LeaderboardEntry extends Personnel {
  wins: number
  losses: number
  draws: number
  matches: number
}

export interface PersonRef {
  id: number
  name: string
  rank: string
}

export type RoundStatus = 'active' | 'completed'

export interface Round {
  id: number
  name: string
  /** When the round started. */
  dtg: IsoDateTime
  status: RoundStatus
  total_matchups: number
  completed_matchups: number
  created_at: IsoDateTime
  /** Null while the round is active. Use this, not dtg, for "completed" times. */
  completed_at: IsoDateTime | null
}

export interface RoundCreate {
  /** Defaults to "Round N" on the backend. */
  name?: string
}

/** `total` excludes cancelled matchups. `percent` is 0..100. */
export interface Progress {
  total: number
  completed: number
  remaining: number
  percent: number
}

export interface RoundWithProgress extends Round {
  progress: Progress
}

export interface Stats {
  total_personnel: number
  total_ratings: number
  avg_elo: number
  highest_elo: number
  lowest_elo: number
  current_round: RoundWithProgress | null
  completed_rounds: number
}

export interface Standing {
  id: number
  name: string
  rank: string
  starting_elo: number
  final_elo: number
  change: number
}

export interface RoundStatistics {
  total_ratings: number
  biggest_gain: number
  biggest_loss: number
  total_personnel: number
}

export interface RoundDetail {
  round: Round
  progress: Progress
  /** Sorted by final_elo, highest first. */
  standings: Standing[]
  statistics: RoundStatistics
}

export interface MatchupRef {
  id: number
  position: number
}

/** Expected score for each side, 0..1. */
export interface Expected {
  a: number
  b: number
}

/** Rating changes (deltas, not new ratings) for person A and person B. */
export interface Deltas {
  a: number
  b: number
}

export interface Preview {
  a_wins: Deltas
  b_wins: Deltas
  draw: Deltas
}

export interface NextMatchupReady {
  status: 'ready'
  round: Round
  progress: Progress
  matchup: MatchupRef
  person_a: Personnel
  person_b: Personnel
  expected: Expected
  preview: Preview
}

export interface NoActiveRound {
  status: 'no_active_round'
  active_personnel: number
  last_completed_round_id: number | null
}

/** Narrow on `status` before reading the other fields. */
export type NextMatchup = NextMatchupReady | NoActiveRound

export interface Rating {
  id: number
  round_id: number
  rated_at: IsoDateTime
  person_a: PersonRef
  person_b: PersonRef
  /** Null for a draw. */
  winner_id: number | null
  a_before: number
  a_after: number
  b_before: number
  b_after: number
}

export interface ResultOut {
  rating: Rating
  round_completed: boolean
}

export interface SkipOut {
  matchup: MatchupRef
}

/** One point per person per completed round. round_number 0 is the starting value. */
export interface RoundProgressionPoint {
  personnel_id: number
  name: string
  rank: string
  round_number: number
  round_name: string
  elo_score: number
}

/** One point per participant per rating. `sequence` is the 1-based rating index. */
export interface RatingProgressionPoint {
  sequence: number
  rating_id: number
  rated_at: IsoDateTime
  personnel_id: number
  name: string
  rank: string
  elo_score: number
}
