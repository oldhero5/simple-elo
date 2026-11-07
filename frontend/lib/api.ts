/**
 * Typed client for the backend API.
 *
 * Every request goes to a relative `/api/...` URL on the page's own origin.
 * The route handler in app/api/[...path]/route.ts forwards it to the backend,
 * so the app works from any device that can open the frontend (for example a
 * phone on the tailnet) without CORS or a build-time backend URL.
 *
 * Failures always reject with an ApiError whose `message` is safe to show to
 * the user (the backend's `detail` when it sent one).
 */
import type {
  LeaderboardEntry,
  NextMatchup,
  Personnel,
  PersonnelCreate,
  PersonnelUpdate,
  Rating,
  RatingProgressionPoint,
  ResultOut,
  Round,
  RoundCreate,
  RoundDetail,
  RoundProgressionPoint,
  RoundStatus,
  SkipOut,
  Stats,
} from './types'

const API_BASE = '/api'

/** Status used for failures that never got an HTTP response (offline, DNS, CORS). */
export const NETWORK_ERROR_STATUS = 0

/** A failed API call. `message` is user-facing; `status` is the HTTP status or 0. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** True for errors caused by aborting a request (component unmounted, newer request started). */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

/**
 * Converts anything thrown into an ApiError with a readable message. Errors
 * that did not come from request() are bugs, not API failures: they are
 * logged for the developer and shown to the user as a generic message.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  console.error(error)
  return new ApiError(NETWORK_ERROR_STATUS, 'Something went wrong')
}

type QueryValue = string | number | boolean | null | undefined

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Appended as a query string; null and undefined values are skipped. */
  query?: Record<string, QueryValue>
  /** Serialized as JSON. */
  body?: unknown
  signal?: AbortSignal
}

/** Options accepted by the read-only endpoint helpers. */
export interface CallOptions {
  signal?: AbortSignal
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) params.set(key, String(value))
  }
  const search = params.toString()
  return `${API_BASE}${path}${search ? `?${search}` : ''}`
}

interface ValidationIssue {
  loc?: unknown[]
  msg?: string
}

// FastAPI sends {"detail": "..."} for HTTPException and, by default,
// {"detail": [{loc, msg, ...}]} for 422s. Accept both shapes.
function detailMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('detail' in payload)) return null
  const detail = (payload as { detail: unknown }).detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const parts = detail
      .map((issue: ValidationIssue) => {
        if (!issue || typeof issue.msg !== 'string') return null
        const field = (issue.loc ?? []).filter((part) => part !== 'body').join('.')
        return field ? `${field}: ${issue.msg}` : issue.msg
      })
      .filter((part): part is string => Boolean(part))
    if (parts.length > 0) return parts.join('; ')
  }
  return null
}

function fallbackMessage(status: number): string {
  if (status === 404) return 'Not found'
  if (status === 409) return 'This conflicts with a recent change. Reload and try again.'
  if (status === 422) return 'Some of the values are not valid'
  if (status === 502 || status === 503 || status === 504) return 'The server is not responding'
  if (status >= 500) return 'The server ran into a problem'
  return `Request failed (${status})`
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Sends one request to `/api{path}` and returns the parsed JSON body.
 * Resolves to `undefined` for 204 or empty responses.
 *
 * @example request<Personnel[]>('/personnel', { query: { active_only: false } })
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, signal } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: 'no-store',
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new ApiError(
      NETWORK_ERROR_STATUS,
      'Could not reach the server. Check your connection and try again.'
    )
  }

  const text = response.status === 204 ? '' : await response.text()
  const payload = text ? parseJson(text) : undefined

  if (!response.ok) {
    throw new ApiError(response.status, detailMessage(payload) ?? fallbackMessage(response.status))
  }
  if (text && payload === undefined) {
    throw new ApiError(response.status, 'The server sent a response that could not be read')
  }
  return payload as T
}

// Health

// Personnel

/** Sorted by current rating, highest first. Pass `activeOnly: false` to include inactive people. */
export function listPersonnel({
  activeOnly = true,
  signal,
}: CallOptions & { activeOnly?: boolean } = {}): Promise<Personnel[]> {
  return request<Personnel[]>('/personnel', { query: { active_only: activeOnly }, signal })
}

/** 201 with the new person; 409 if an active person already has the same name and rank. */
export function createPersonnel(body: PersonnelCreate): Promise<Personnel> {
  return request<Personnel>('/personnel', { method: 'POST', body })
}

/** Partial update. `{ active: false }` deactivates, `{ active: true }` reactivates. */
export function updatePersonnel(id: number, body: PersonnelUpdate): Promise<Personnel> {
  return request<Personnel>(`/personnel/${id}`, { method: 'PATCH', body })
}

// Reports

/** Active people with win/loss/draw counts, highest rating first. */
export function getLeaderboard(opts: CallOptions = {}): Promise<LeaderboardEntry[]> {
  return request<LeaderboardEntry[]>('/leaderboard', opts)
}

export function getStats(opts: CallOptions = {}): Promise<Stats> {
  return request<Stats>('/stats', opts)
}

/** Most recent ratings first. `limit` is 1..200. */
export function listRatings({ limit = 20, signal }: CallOptions & { limit?: number } = {}): Promise<
  Rating[]
> {
  return request<Rating[]>('/ratings', { query: { limit }, signal })
}

export function getProgressionByRounds(opts: CallOptions = {}): Promise<RoundProgressionPoint[]> {
  return request<RoundProgressionPoint[]>('/elo-progression/by-rounds', opts)
}

export function getProgressionByRatings(opts: CallOptions = {}): Promise<RatingProgressionPoint[]> {
  return request<RatingProgressionPoint[]>('/elo-progression/by-ratings', opts)
}

// Rounds

/** Newest first, optionally filtered by status. */
export function listRounds({
  status,
  signal,
}: CallOptions & { status?: RoundStatus } = {}): Promise<Round[]> {
  return request<Round[]>('/rounds', { query: { status }, signal })
}

/**
 * Starts a round with every pair of active people. Fails with 400 when fewer
 * than 2 people are active and 409 when a round is already active, unless
 * `force` is true, which ends the active round first.
 */
export function createRound({
  name,
  force = false,
}: RoundCreate & { force?: boolean } = {}): Promise<Round> {
  return request<Round>('/rounds', {
    method: 'POST',
    query: { force: force || undefined },
    body: name ? { name } : undefined,
  })
}

export function getRound(id: number, opts: CallOptions = {}): Promise<RoundDetail> {
  return request<RoundDetail>(`/rounds/${id}`, opts)
}

// Matchups

/** The next pending matchup of the active round, or why there is none. Narrow on `status`. */
export function getNextMatchup(opts: CallOptions = {}): Promise<NextMatchup> {
  return request<NextMatchup>('/matchups/next', opts)
}

/**
 * Records a result. `winnerId` is one of the two people, or null for a draw.
 * 409 if the matchup was already rated or its round is no longer active.
 */
export function submitResult(matchupId: number, winnerId: number | null): Promise<ResultOut> {
  return request<ResultOut>(`/matchups/${matchupId}/result`, {
    method: 'POST',
    body: { winner_id: winnerId },
  })
}

/** Moves a pending matchup to the end of its round's queue. */
export function skipMatchup(matchupId: number): Promise<SkipOut> {
  return request<SkipOut>(`/matchups/${matchupId}/skip`, { method: 'POST' })
}
