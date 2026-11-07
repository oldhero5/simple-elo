'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'

import {
  CHART_HEIGHT,
  type ChartPerson,
  type ChartView,
  buildRatingChart,
  buildRoundChart,
} from '@/components/dashboard/chartData'
import {
  EmptyState,
  ErrorAlert,
  Section,
  type SegmentedOption,
  SegmentedControl,
  Skeleton,
} from '@/components/ui'
import { getProgressionByRatings, getProgressionByRounds } from '@/lib/api'
import { useApi } from '@/lib/useApi'

const VIEW_OPTIONS: ReadonlyArray<SegmentedOption<ChartView>> = [
  { value: 'rounds', label: 'By round' },
  { value: 'ratings', label: 'By vote' },
]

const EMPTY_MESSAGES: Record<ChartView, string> = {
  rounds: 'Rating history by round shows up here once a round is complete.',
  ratings: 'No votes for the people on the roster yet.',
}

function ChartSkeleton() {
  return (
    <div role="status" aria-label="Loading chart">
      <Skeleton className={`${CHART_HEIGHT} rounded-lg`} />
    </div>
  )
}

const ChartFigure = dynamic(() => import('@/components/dashboard/ChartFigure'), {
  ssr: false,
  loading: ChartSkeleton,
})

export interface EloChartProps {
  /** Active people, highest rating first. Sets line labels, colors and legend order. */
  people: readonly ChartPerson[]
  /** The view shown first. Each view's data is fetched the first time it is shown. */
  initialView?: ChartView
}

/** The "Rating history" section: one line per person, by round or by rating. */
export default function EloChart({ people, initialView = 'rounds' }: EloChartProps) {
  const [view, setView] = useState<ChartView>(initialView)
  const [opened, setOpened] = useState<Record<ChartView, boolean>>(() => ({
    rounds: initialView === 'rounds',
    ratings: initialView === 'ratings',
  }))

  const byRounds = useApi(
    (signal) => (opened.rounds ? getProgressionByRounds({ signal }) : Promise.resolve(undefined)),
    [opened.rounds]
  )
  const byRatings = useApi(
    (signal) => (opened.ratings ? getProgressionByRatings({ signal }) : Promise.resolve(undefined)),
    [opened.ratings]
  )
  const current = view === 'rounds' ? byRounds : byRatings

  const model = useMemo(() => {
    if (view === 'rounds') return byRounds.data && buildRoundChart(byRounds.data, people)
    return byRatings.data && buildRatingChart(byRatings.data, people)
  }, [view, byRounds.data, byRatings.data, people])

  function changeView(next: ChartView) {
    setView(next)
    setOpened((prev) => (prev[next] ? prev : { ...prev, [next]: true }))
  }

  let body
  if (model) {
    body =
      model.rows.length > 0 ? (
        <ChartFigure model={model} view={view} />
      ) : (
        <EmptyState align="center" className="h-40">
          {EMPTY_MESSAGES[view]}
        </EmptyState>
      )
  } else if (current.error) {
    body = (
      <ErrorAlert
        error={current.error}
        onRetry={() => void current.reload()}
        retrying={current.loading}
      />
    )
  } else {
    body = <ChartSkeleton />
  }

  return (
    <Section
      title="Rating history"
      actions={
        <SegmentedControl
          label="Chart view"
          options={VIEW_OPTIONS}
          value={view}
          onChange={changeView}
        />
      }
    >
      {body}
    </Section>
  )
}
