'use client'

/**
 * The Recharts part of the Rating history chart. It is loaded on demand by
 * components/EloChart.tsx so Recharts is not in the dashboard's first bundle.
 */
import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  CHART_HEIGHT,
  type ChartModel,
  type ChartRow,
  type ChartSeries,
  type ChartView,
  ratingAxis,
} from '@/components/dashboard/chartData'
import { formatDateTime, formatRating } from '@/lib/format'

const GRID_COLOR = '#27272a'
const AXIS_TEXT = { fill: '#a1a1aa', fontSize: 12 }
const TOOLTIP_MAX_ITEMS = 10

// Axis labels longer than this are cut so the last one fits inside the chart's right margin.
function shortLabel(label: string): string {
  return label.length > 12 ? `${label.slice(0, 11)}…` : label
}

export default function ChartFigure({ model, view }: { model: ChartModel; view: ChartView }) {
  const { rows, series, xTicks } = model
  const byRound = view === 'rounds'
  const yAxis = useMemo(() => ratingAxis(rows, series), [rows, series])
  const seriesByKey = useMemo(() => new Map(series.map((item) => [item.key, item])), [series])
  const { tickValues, tickLabels } = useMemo(
    () => ({
      tickValues: xTicks.map((tick) => tick.value),
      tickLabels: new Map(xTicks.map((tick) => [tick.value, tick.label])),
    }),
    [xTicks]
  )
  const people = series.length === 1 ? '1 person' : `${series.length} people`

  return (
    <div>
      <div
        role="img"
        aria-label={`Line chart of ratings ${byRound ? 'after each completed round' : 'after each rating'} for ${people}.`}
        className={`${CHART_HEIGHT} tabular-nums`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_COLOR} />
            <XAxis
              dataKey="x"
              type="number"
              domain={['dataMin', 'dataMax']}
              allowDecimals={false}
              ticks={tickValues}
              interval="preserveStartEnd"
              minTickGap={12}
              padding={{ left: 12, right: 20 }}
              tick={AXIS_TEXT}
              tickMargin={8}
              tickLine={false}
              axisLine={{ stroke: GRID_COLOR }}
              tickFormatter={(value: number) => shortLabel(tickLabels.get(value) ?? '')}
            />
            <YAxis
              domain={yAxis.domain}
              ticks={yAxis.ticks}
              allowDecimals={false}
              width={44}
              tick={AXIS_TEXT}
              tickMargin={6}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => formatRating(value)}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: '#3f3f46', strokeWidth: 1 }}
              content={<ChartTooltip seriesByKey={seriesByKey} />}
            />
            {series.map((item) => (
              <Line
                key={item.key}
                type="linear"
                dataKey={item.key}
                name={item.label}
                stroke={item.color}
                strokeWidth={1.75}
                strokeDasharray={item.dash}
                connectNulls
                isAnimationActive={false}
                dot={byRound ? { r: 2.5, fill: item.color, strokeWidth: 0 } : false}
                activeDot={{ r: 4, fill: item.color, strokeWidth: 0 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-300">
        {series.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <Swatch series={item} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Swatch({ series }: { series: ChartSeries }) {
  return (
    <svg aria-hidden="true" width="14" height="8" viewBox="0 0 14 8" className="shrink-0">
      <line
        x1="0"
        y1="4"
        x2="14"
        y2="4"
        stroke={series.color}
        strokeWidth="2"
        strokeDasharray={series.dash}
      />
    </svg>
  )
}

interface TooltipEntry {
  dataKey?: unknown
  value?: unknown
  payload?: unknown
}

// Recharts clones the tooltip element and passes `active` and `payload`.
interface ChartTooltipProps {
  active?: boolean
  payload?: readonly TooltipEntry[]
  seriesByKey: ReadonlyMap<string, ChartSeries>
}

function ChartTooltip({ active, payload, seriesByKey }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload as ChartRow
  const items = payload
    .flatMap((entry) => {
      const series = seriesByKey.get(String(entry.dataKey))
      return series && typeof entry.value === 'number' ? [{ series, value: entry.value }] : []
    })
    .sort((a, b) => b.value - a.value)
  const hidden = items.length - TOOLTIP_MAX_ITEMS

  return (
    <div className="min-w-40 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs tabular-nums">
      <p className="font-medium text-zinc-100">{row.label}</p>
      {row.ratedAt ? <p className="text-zinc-400">{formatDateTime(row.ratedAt)}</p> : null}
      <ul className="mt-1.5 space-y-1">
        {items.slice(0, TOOLTIP_MAX_ITEMS).map(({ series, value }) => (
          <li key={series.key} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-1.5 text-zinc-300">
              <Swatch series={series} />
              <span className="truncate">{series.label}</span>
            </span>
            <span className="text-zinc-100">{formatRating(value)}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 ? <p className="mt-1 text-zinc-400">and {hidden} more</p> : null}
    </div>
  )
}
