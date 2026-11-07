/**
 * Display formatting shared by every page, so the same value always reads the
 * same way. Numbers render with `tabular-nums` in the UI, not a monospace font.
 */
import type { IsoDateTime } from './types'

const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** A rating with a thousands separator: 1034 -> "1,034". */
export function formatRating(value: number): string {
  return integerFormat.format(Math.round(value))
}

/** Any whole number with a thousands separator: 12345 -> "12,345". */
export function formatCount(value: number): string {
  return integerFormat.format(Math.round(value))
}

/**
 * A rating change with an explicit sign: 16 -> "+16", -16 -> "-16", 0 -> "0".
 * Uses the ASCII hyphen-minus everywhere for consistency.
 */
export function formatDelta(value: number): string {
  const rounded = Math.round(value)
  if (rounded > 0) return `+${integerFormat.format(rounded)}`
  if (rounded < 0) return `-${integerFormat.format(-rounded)}`
  return '0'
}

/** Text color class for a rating change. Pair it with formatDelta so color is never the only signal. */
export function deltaClass(value: number): string {
  const rounded = Math.round(value)
  if (rounded > 0) return 'text-emerald-400'
  if (rounded < 0) return 'text-rose-400'
  return 'text-zinc-400'
}

/** A 0..1 probability as a whole percent: 0.638 -> "64%". */
export function formatProbability(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** Win-loss-draw record: (3, 1, 0) -> "3-1-0". */
export function formatRecord(wins: number, losses: number, draws: number): string {
  return `${wins}-${losses}-${draws}`
}

/** Rank and name as people are addressed: {rank: "CPT", name: "Diaz"} -> "CPT Diaz". */
export function formatPerson(person: { rank: string; name: string }): string {
  return `${person.rank} ${person.name}`
}

function toDate(value: IsoDateTime | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/**
 * Date and time in the viewer's locale and time zone: "Nov 7, 2026, 2:22 PM".
 * The API sends UTC with a `Z` suffix, so the browser converts it correctly.
 * The date helpers depend on the viewer's locale and clock, so call them only
 * for data loaded in the browser, never during server rendering.
 */
export function formatDateTime(value: IsoDateTime | Date): string {
  return dateTimeFormat.format(toDate(value))
}

/** Date only, in the viewer's locale: "Nov 7, 2026". */
export function formatDate(value: IsoDateTime | Date): string {
  return dateFormat.format(toDate(value))
}

const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Short relative time for recent events: "just now", "5 minutes ago",
 * "3 hours ago", "yesterday", "4 days ago". Anything older than a week falls
 * back to formatDate. Pass `now` to keep a list consistent within one render.
 */
export function formatRelativeTime(value: IsoDateTime | Date, now: number = Date.now()): string {
  const elapsed = now - toDate(value).getTime()
  // Treat small clock skew between devices as "just now" rather than "in 1 minute".
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return relativeFormat.format(-Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return relativeFormat.format(-Math.floor(elapsed / HOUR), 'hour')
  if (elapsed < 7 * DAY) return relativeFormat.format(-Math.floor(elapsed / DAY), 'day')
  return formatDate(value)
}
