/**
 * Turns the two progression endpoints into rows and series for the Recharts
 * line chart in components/EloChart.tsx. Series are keyed by personnel id, so
 * two people with the same rank and name stay separate and a promotion does
 * not split one person into two lines.
 */
import { formatCount, formatPerson } from '@/lib/format'
import type { Personnel, RatingProgressionPoint, RoundProgressionPoint } from '@/lib/types'

export type ChartView = 'rounds' | 'ratings'

/** Chart height (220px on phones, 280px from sm), shared by the chart and its placeholder. */
export const CHART_HEIGHT = 'h-[220px] sm:h-[280px]'

/** The fields the chart needs about each active person. */
export type ChartPerson = Pick<Personnel, 'id' | 'name' | 'rank' | 'initial_elo'>

/** One x position. Ratings live under the series keys (`p<personnel id>`). */
export interface ChartRow {
  x: number
  label: string
  ratedAt?: string
  [seriesKey: string]: number | string | undefined
}

export interface ChartSeries {
  key: string
  label: string
  color: string
  dash?: string
}

export interface ChartModel {
  rows: ChartRow[]
  /** Ordered like the standings: highest current rating first. */
  series: ChartSeries[]
  /** X axis tick positions and their labels. */
  xTicks: XTick[]
}

export interface XTick {
  value: number
  label: string
}

const SERIES_COLORS = [
  '#60a5fa',
  '#f59e0b',
  '#34d399',
  '#f472b6',
  '#a78bfa',
  '#f87171',
  '#2dd4bf',
  '#facc15',
] as const

// Colors repeat after eight people, so the second and third sets of lines are
// dashed or dotted to keep them apart.
const SERIES_DASHES = [undefined, '5 3', '1.5 3'] as const

function seriesKey(personnelId: number): string {
  return `p${personnelId}`
}

class RowBuilder {
  private readonly rows = new Map<number, ChartRow>()

  set(x: number, label: string, personnelId: number, rating: number, ratedAt?: string): void {
    let row = this.rows.get(x)
    if (!row) {
      row = { x, label }
      this.rows.set(x, row)
    }
    if (ratedAt) row.ratedAt = ratedAt
    row[seriesKey(personnelId)] = rating
  }

  build(): ChartRow[] {
    return Array.from(this.rows.values()).sort((a, b) => a.x - b.x)
  }
}

const X_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
const X_MAX_INTERVALS = 5

/** Round-number ticks (0, 20, 40, ...) across the rows of the per-rating view. */
function ratingTicks(rows: readonly ChartRow[]): XTick[] {
  if (rows.length === 0) return []
  const first = rows[0].x
  const last = rows[rows.length - 1].x
  const step =
    X_STEPS.find((candidate) => (last - first) / candidate <= X_MAX_INTERVALS) ??
    X_STEPS[X_STEPS.length - 1]
  const ticks: XTick[] = []
  for (let value = Math.ceil(first / step) * step; value <= last; value += step) {
    ticks.push({ value, label: value === 0 ? 'Start' : formatCount(value) })
  }
  return ticks
}

/**
 * Where a person's starting value goes: at x = 0 ("Start") when they took part
 * from the first round or vote, otherwise half a step before their first one.
 * Putting it on the previous row instead would list them in that row's
 * tooltip (and draw a dot there) as if they had taken part.
 */
function startPosition(first: number): number {
  return first <= 1 ? 0 : first - 0.5
}

/**
 * Colors come from each person's position by id, so a person keeps the same
 * color in both views and when the standings change. Ids in the data but not
 * in `people` (deactivated between requests) are styled after everyone else.
 */
function buildSeries(
  people: readonly ChartPerson[],
  fallbackLabels: ReadonlyMap<number, string>
): ChartSeries[] {
  const known = new Set(people.map((person) => person.id))
  const extras = Array.from(fallbackLabels.keys())
    .filter((id) => !known.has(id))
    .sort((a, b) => a - b)
  const styleOrder = [...Array.from(known).sort((a, b) => a - b), ...extras]
  const styleIndex = new Map(styleOrder.map((id, index) => [id, index]))
  const labels = new Map(people.map((person) => [person.id, formatPerson(person)]))
  const order = [
    ...people.map((person) => person.id).filter((id) => fallbackLabels.has(id)),
    ...extras,
  ]

  return order.map((id) => {
    const index = styleIndex.get(id) ?? 0
    return {
      key: seriesKey(id),
      label: labels.get(id) ?? fallbackLabels.get(id) ?? `Person ${id}`,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      dash: SERIES_DASHES[Math.floor(index / SERIES_COLORS.length) % SERIES_DASHES.length],
    }
  })
}

/**
 * One row per completed round. The backend reports every person's starting
 * value as round 0, including people who joined in a later round, so that
 * value is moved to just before the first round they took part in.
 */
export function buildRoundChart(
  points: readonly RoundProgressionPoint[],
  people: readonly ChartPerson[]
): ChartModel {
  const roundNames = new Map<number, string>()
  const firstRound = new Map<number, number>()
  const fallbackLabels = new Map<number, string>()
  for (const point of points) {
    fallbackLabels.set(point.personnel_id, formatPerson(point))
    if (point.round_number === 0) continue
    roundNames.set(point.round_number, point.round_name)
    const first = firstRound.get(point.personnel_id)
    if (first === undefined || point.round_number < first) {
      firstRound.set(point.personnel_id, point.round_number)
    }
  }
  const roundName = (number: number) => roundNames.get(number) ?? `Round ${number}`

  const builder = new RowBuilder()
  for (const point of points) {
    if (point.round_number !== 0) {
      builder.set(
        point.round_number,
        roundName(point.round_number),
        point.personnel_id,
        point.elo_score
      )
      continue
    }
    const first = firstRound.get(point.personnel_id) ?? 1
    const x = startPosition(first)
    builder.set(
      x,
      x === 0 ? 'Start' : `Before ${roundName(first)}`,
      point.personnel_id,
      point.elo_score
    )
  }

  const rows = builder.build()
  // Half-step rows hold late joiners' starting values; only whole rounds get a tick.
  const xTicks = rows
    .filter((row) => Number.isInteger(row.x))
    .map((row) => ({ value: row.x, label: row.label }))
  return { rows, xTicks, series: buildSeries(people, fallbackLabels) }
}

/**
 * One row per vote. The endpoint only reports each person's rating after a
 * vote, so their initial rating is added before their first one. Ratings only
 * change through votes, so that value is exact, and it gives a person with a
 * single vote a visible line.
 */
export function buildRatingChart(
  points: readonly RatingProgressionPoint[],
  people: readonly ChartPerson[]
): ChartModel {
  const builder = new RowBuilder()
  const firstVote = new Map<number, number>()
  const fallbackLabels = new Map<number, string>()
  for (const point of points) {
    fallbackLabels.set(point.personnel_id, formatPerson(point))
    builder.set(
      point.sequence,
      `Rating ${point.sequence}`,
      point.personnel_id,
      point.elo_score,
      point.rated_at
    )
    const first = firstVote.get(point.personnel_id)
    if (first === undefined || point.sequence < first) {
      firstVote.set(point.personnel_id, point.sequence)
    }
  }
  for (const person of people) {
    const first = firstVote.get(person.id)
    if (first === undefined) continue
    const x = startPosition(first)
    builder.set(x, x === 0 ? 'Start' : `Before rating ${first}`, person.id, person.initial_elo)
  }

  const rows = builder.build()
  return { rows, xTicks: ratingTicks(rows), series: buildSeries(people, fallbackLabels) }
}

const Y_STEPS = [10, 20, 25, 50, 100, 200, 250, 500, 1000]
const Y_MAX_INTERVALS = 5
const Y_HEADROOM = 10

export interface RatingAxis {
  domain: [number, number]
  ticks: number[]
}

/**
 * Y axis bounds and evenly spaced round-number ticks. Recharts' own tick
 * choice can produce steps like 62.5, which it then rounds to uneven labels.
 */
export function ratingAxis(rows: readonly ChartRow[], series: readonly ChartSeries[]): RatingAxis {
  let min = Infinity
  let max = -Infinity
  for (const row of rows) {
    for (const { key } of series) {
      const value = row[key]
      if (typeof value !== 'number') continue
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  if (!Number.isFinite(min)) {
    min = 1000
    max = 1000
  }

  let low = 0
  let high = 0
  let step = Y_STEPS[Y_STEPS.length - 1]
  for (const candidate of Y_STEPS) {
    low = Math.floor((min - Y_HEADROOM) / candidate) * candidate
    high = Math.ceil((max + Y_HEADROOM) / candidate) * candidate
    step = candidate
    if ((high - low) / candidate <= Y_MAX_INTERVALS) break
  }
  const ticks: number[] = []
  for (let tick = low; tick <= high; tick += step) ticks.push(tick)
  return { domain: [low, high], ticks }
}
