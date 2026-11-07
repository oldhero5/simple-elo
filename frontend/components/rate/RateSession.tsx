'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { MatchupPanel, ShortcutHint } from '@/components/rate/MatchupPanel'
import { RateSkeleton } from '@/components/rate/RateSkeleton'
import { RoundStandings } from '@/components/rate/RoundStandings'
import { describeRating, notDone } from '@/components/rate/messages'
import { type Choice } from '@/components/rate/useRateShortcuts'
import { useShowRatings } from '@/components/rate/useShowRatings'
import {
  Button,
  ErrorAlert,
  InlineConfirm,
  LinkButton,
  LiveRegion,
  PageHeader,
  ProgressBar,
} from '@/components/ui'
import {
  ApiError,
  createRound,
  getNextMatchup,
  getRound,
  listRounds,
  skipMatchup,
  submitResult,
} from '@/lib/api'
import { cx } from '@/lib/cx'
import { formatCount, formatDateTime } from '@/lib/format'
import { type NextMatchupReady, type Round, type RoundDetail } from '@/lib/types'
import { useAction, useApi } from '@/lib/useApi'

type RateView =
  | { kind: 'ready'; next: NextMatchupReady }
  | {
      kind: 'idle'
      /** Standings to show: the round that just ended, or the latest completed one. */
      finished: RoundDetail | null
      /** An active round with nothing left that can be rated (data changed outside the app). */
      openRound: Round | null
      activePeople: number
      nextRoundNumber: number
    }

type Command =
  | { type: 'vote'; next: NextMatchupReady; choice: 'a' | 'b' | 'draw' }
  | { type: 'skip'; next: NextMatchupReady }
  | { type: 'start'; force: boolean }

interface Outcome {
  text: string
  /** Set to change which round the idle view shows; undefined leaves it alone. */
  finishedRoundId?: number | null
}

async function loadView(signal: AbortSignal, finishedRoundId: number | null): Promise<RateView> {
  const next = await getNextMatchup({ signal })
  if (next.status === 'ready') return { kind: 'ready', next }
  const roundId = finishedRoundId ?? next.last_completed_round_id
  const [rounds, finished] = await Promise.all([
    listRounds({ signal }),
    roundId === null ? Promise.resolve(null) : getRound(roundId, { signal }),
  ])
  return {
    kind: 'idle',
    finished,
    openRound: rounds.find((round) => round.status === 'active') ?? null,
    activePeople: next.active_personnel,
    // The backend names a new round "Round N", where N is the number of rounds so far plus 1.
    nextRoundNumber: rounds.length + 1,
  }
}

async function execute(command: Command): Promise<Outcome> {
  switch (command.type) {
    case 'vote': {
      const { next, choice } = command
      const winnerId = choice === 'a' ? next.person_a.id : choice === 'b' ? next.person_b.id : null
      const { rating, round_completed } = await submitResult(next.matchup.id, winnerId)
      const text = describeRating(rating)
      if (!round_completed) return { text }
      return { text: `${text} ${next.round.name} complete.`, finishedRoundId: rating.round_id }
    }
    case 'skip':
      await skipMatchup(command.next.matchup.id)
      return { text: 'Skipped. This pair comes back at the end of the round.' }
    case 'start': {
      const round = await createRound({ force: command.force })
      return { text: `Started ${round.name}.`, finishedRoundId: null }
    }
  }
}

const NOT_DONE: Record<Command['type'], string> = {
  vote: 'Not recorded.',
  skip: 'Not skipped.',
  start: 'Not started.',
}

// 400, 404 and 409 mean the page was out of date: another tab or device rated
// this pair or changed the round, or the roster changed. Say why and load the
// current state instead of showing an error.
function isStaleStateError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.status === 400 || error.status === 404 || error.status === 409)
  )
}

function choiceOf(command: Command): Choice | null {
  if (command.type === 'vote') return command.choice
  if (command.type === 'skip') return 'skip'
  return null
}

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`
}

/** The whole Rate page below the site header. */
export function RateSession() {
  const finishedRoundRef = useRef<number | null>(null)
  const view = useApi((signal) => loadView(signal, finishedRoundRef.current), [])
  const { reload } = view
  const [showRatings, setShowRatings] = useShowRatings()
  const [message, setMessage] = useState({ id: 0, text: '' })
  const [lastCommand, setLastCommand] = useState<Command | null>(null)
  const [confirming, setConfirming] = useState(false)

  const announce = useCallback((text: string) => {
    setMessage((previous) => ({ id: previous.id + 1, text }))
  }, [])

  const perform = useCallback(
    async (command: Command) => {
      setLastCommand(command)
      try {
        let outcome: Outcome
        try {
          outcome = await execute(command)
        } catch (error) {
          if (!isStaleStateError(error)) throw error
          outcome = { text: notDone(NOT_DONE[command.type], error.message) }
        }
        if (outcome.finishedRoundId !== undefined) {
          finishedRoundRef.current = outcome.finishedRoundId
        }
        announce(outcome.text)
        // Still inside the action, so the controls stay disabled until the next pair is shown.
        await reload()
      } finally {
        if (command.type === 'start') setConfirming(false)
      }
    },
    [announce, reload]
  )
  const action = useAction(perform)

  const data = view.data
  const kind = data?.kind

  useEffect(() => {
    if (kind === 'ready') finishedRoundRef.current = null
  }, [kind])

  // When the view switches (last vote of a round, or a new round started), the
  // focused control is removed. Move focus to the new heading instead of
  // leaving it on the document body.
  const titleRef = useRef<HTMLSpanElement>(null)
  const previousKind = useRef(kind)
  useEffect(() => {
    const before = previousKind.current
    previousKind.current = kind
    if (before !== undefined && before !== kind && document.activeElement === document.body) {
      titleRef.current?.focus()
    }
  }, [kind])

  const startButtonRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef(false)
  useEffect(() => {
    if (!confirming && restoreFocusRef.current) {
      restoreFocusRef.current = false
      startButtonRef.current?.focus()
    }
  }, [confirming])

  const busy = action.pending || view.loading
  const stale = view.error !== null && data !== undefined
  const pendingChoice = action.pending && lastCommand ? choiceOf(lastCommand) : null

  function runCommand(command: Command) {
    if (busy) return
    if (command.type !== 'start') setConfirming(false)
    void action.run(command)
  }

  function choose(next: NextMatchupReady, choice: Choice) {
    if (busy || stale) return
    if (choice !== 'skip') {
      runCommand({ type: 'vote', next, choice })
    } else if (next.progress.remaining <= 1) {
      announce(`This is the last pair left in ${next.round.name}.`)
    } else {
      runCommand({ type: 'skip', next })
    }
  }

  const alert = action.error ? (
    <ErrorAlert
      error={action.error}
      onRetry={lastCommand ? () => runCommand(lastCommand) : undefined}
      retrying={action.pending}
    />
  ) : stale ? (
    <ErrorAlert error={view.error} onRetry={() => void reload()} retrying={view.loading} />
  ) : null

  let header: ReactNode
  let body: ReactNode = null
  let after: ReactNode = null

  if (data === undefined) {
    if (view.error) {
      header = <PageHeader key="error" title="Rate" />
      body = <ErrorAlert error={view.error} onRetry={() => void reload()} retrying={view.loading} />
    } else {
      header = <RateSkeleton />
    }
  } else if (data.kind === 'ready') {
    const { next } = data
    const { progress, round } = next
    // Keyed by view so React mounts fresh controls instead of morphing, say, the
    // primary "Start round 2" button into this secondary one.
    header = (
      <PageHeader
        key="ready"
        title={
          <span ref={titleRef} tabIndex={-1}>
            {round.name}
          </span>
        }
        description={`${formatCount(progress.completed)} of ${formatCount(progress.total)} rated`}
        actions={
          confirming ? (
            // On phones, put the question on its own line so Yes and Cancel stay together.
            <div className="[&>div>span]:basis-full sm:[&>div>span]:basis-auto">
              <InlineConfirm
                message={`End ${round.name} early and start a new one?`}
                onConfirm={() => runCommand({ type: 'start', force: true })}
                onCancel={() => {
                  restoreFocusRef.current = true
                  setConfirming(false)
                }}
                pending={action.pending && lastCommand?.type === 'start'}
              />
            </div>
          ) : (
            // Opening the confirm sends nothing, so it stays available during a vote.
            <Button ref={startButtonRef} onClick={() => setConfirming(true)}>
              Start new round
            </Button>
          )
        }
      >
        <ProgressBar value={progress.completed} max={progress.total} label="Round progress" />
      </PageHeader>
    )
    body = (
      <div className="space-y-3">
        {alert}
        <MatchupPanel
          next={next}
          disabled={busy || stale}
          shortcutsEnabled={!confirming}
          pending={pendingChoice}
          showRatings={showRatings}
          onShowRatingsChange={setShowRatings}
          onChoose={(choice) => choose(next, choice)}
        />
      </div>
    )
    after = <ShortcutHint />
  } else {
    const { finished, openRound, activePeople, nextRoundNumber } = data
    const canStart = activePeople >= 2
    const pairs = (activePeople * (activePeople - 1)) / 2

    let title: string
    let description: ReactNode
    if (finished) {
      const completedAt = finished.round.completed_at
      title = `${finished.round.name} complete`
      description = (
        <>
          {completedAt ? (
            <>
              Completed <time dateTime={completedAt}>{formatDateTime(completedAt)}</time>
              {' · '}
            </>
          ) : null}
          {plural(finished.statistics.total_ratings, 'rating', 'ratings')}
        </>
      )
    } else if (!canStart) {
      title = 'No round in progress'
      description = 'A round needs at least 2 active people.'
    } else if (openRound) {
      title = 'No pairs left to rate'
      description =
        `${openRound.name} has no pairs left that can be rated. ` + 'Starting a new round ends it.'
    } else {
      title = 'No round in progress'
      const pairText = plural(pairs, 'pair', 'pairs')
      description = `${formatCount(activePeople)} active people, so a round has ${pairText}.`
    }

    header = (
      <PageHeader
        key="idle"
        title={
          <span ref={titleRef} tabIndex={-1}>
            {title}
          </span>
        }
        description={description}
        actions={
          canStart ? (
            <Button
              variant="primary"
              loading={action.pending}
              aria-disabled={busy || undefined}
              // Nothing rateable is left in an open round here, so ending it loses nothing.
              onClick={() => runCommand({ type: 'start', force: openRound !== null })}
            >
              Start round {nextRoundNumber}
            </Button>
          ) : (
            <LinkButton href="/personnel" variant="primary">
              Add people
            </LinkButton>
          )
        }
      />
    )
    const note =
      finished && !canStart ? (
        <p className="text-sm text-zinc-400">A new round needs at least 2 active people.</p>
      ) : null
    body =
      alert || note ? (
        <div className="space-y-3">
          {alert}
          {note}
        </div>
      ) : null
    after = finished ? <RoundStandings detail={finished} /> : null
  }

  const ready = kind === 'ready'

  return (
    <div>
      {header}
      {body ? <div className="mt-5">{body}</div> : null}
      <LiveRegion className={cx(ready ? 'mt-3 min-h-5' : message.text ? 'mt-4' : undefined)}>
        {message.text ? <span key={message.id}>{message.text}</span> : null}
      </LiveRegion>
      {after ? <div className={ready ? 'mt-2' : 'mt-6'}>{after}</div> : null}
    </div>
  )
}
