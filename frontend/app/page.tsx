'use client'

import { useRouter } from 'next/navigation'
import { type ReactNode, useState } from 'react'

import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton'
import { RecentRatings } from '@/components/dashboard/RecentRatings'
import { Standings } from '@/components/dashboard/Standings'
import { StatStrip } from '@/components/dashboard/StatStrip'
import EloChart from '@/components/EloChart'
import {
  Button,
  EmptyState,
  ErrorAlert,
  LinkButton,
  PageHeader,
  Section,
  Skeleton,
} from '@/components/ui'
import { createRound, getLeaderboard, getStats, listRatings } from '@/lib/api'
import { cx } from '@/lib/cx'
import { useAction, useApi } from '@/lib/useApi'

const RECENT_RATINGS_LIMIT = 8

async function loadDashboard(signal: AbortSignal) {
  const [stats, leaderboard, ratings] = await Promise.all([
    getStats({ signal }),
    getLeaderboard({ signal }),
    listRatings({ limit: RECENT_RATINGS_LIMIT, signal }),
  ])
  return { stats, leaderboard, ratings }
}

export default function DashboardPage() {
  const router = useRouter()
  const { data, error, loading, initialLoading, reload } = useApi(loadDashboard, [])
  const startRound = useAction(createRound)
  const [openingRate, setOpeningRate] = useState(false)

  async function handleStartRound() {
    const result = await startRound.run()
    if (result.ok) {
      // Stay busy until /rate replaces this page, so the button cannot start a second round.
      setOpeningRate(true)
      router.push('/rate')
    } else if (result.error) {
      // Usually someone started a round or changed the roster on another device.
      void reload()
    }
  }

  let action: ReactNode = null
  let description: ReactNode = null
  if (!data) {
    if (initialLoading) action = <Skeleton className="h-9 w-36 rounded-md" />
  } else if (data.stats.current_round) {
    action = (
      <LinkButton href="/rate" variant="primary">
        Rate next matchup
      </LinkButton>
    )
  } else if (data.stats.total_personnel >= 2) {
    action = (
      <Button
        variant="primary"
        loading={startRound.pending || openingRate}
        onClick={() => void handleStartRound()}
      >
        Start round {data.stats.completed_rounds + 1}
      </Button>
    )
  } else if (data.stats.total_personnel === 1) {
    action = (
      <LinkButton href="/personnel" variant="primary">
        Add people
      </LinkButton>
    )
    description = 'Add one more person to start a round.'
  }

  let body: ReactNode
  if (data && data.leaderboard.length === 0) {
    body = (
      <EmptyState
        action={
          <LinkButton href="/personnel" variant="primary">
            Add people
          </LinkButton>
        }
      >
        Add at least two people to start a round.
      </EmptyState>
    )
  } else if (data) {
    const { stats, leaderboard, ratings } = data
    const showRecent = ratings.length > 0
    body = (
      <>
        <StatStrip stats={stats} leaderboard={leaderboard} />
        <div className={cx(showRecent && 'grid gap-8 lg:grid-cols-5 lg:items-start')}>
          <Section title="Standings" className="min-w-0 lg:col-span-3">
            <Standings people={leaderboard} />
          </Section>
          {showRecent ? (
            <Section title="Recent votes" className="min-w-0 lg:col-span-2">
              <RecentRatings ratings={ratings} />
            </Section>
          ) : null}
        </div>
        {stats.total_ratings > 0 ? (
          <EloChart
            people={leaderboard}
            initialView={stats.completed_rounds > 0 ? 'rounds' : 'ratings'}
          />
        ) : null}
      </>
    )
  } else if (!error) {
    body = <DashboardSkeleton />
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" description={description} actions={action}>
        <ErrorAlert error={startRound.error} />
        <ErrorAlert error={error} onRetry={() => void reload()} retrying={loading} />
      </PageHeader>
      {body}
    </div>
  )
}
