import { type ReactNode, useId } from 'react'

import { type Choice, useRateShortcuts } from '@/components/rate/useRateShortcuts'
import { Button, Delta, Kbd } from '@/components/ui'
import { cx } from '@/lib/cx'
import { formatProbability, formatRating } from '@/lib/format'
import { type NextMatchupReady, type Personnel } from '@/lib/types'

type ChoiceState = 'idle' | 'chosen' | 'dimmed'

function RatingLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span>{label}</span>
      <span className="tabular-nums text-zinc-200">{children}</span>
    </span>
  )
}

interface ChoiceButtonProps {
  person: Personnel
  /** This person's expected score, 0..1. */
  expected: number
  /** This person's rating change if they are picked. */
  delta: number
  showRatings: boolean
  state: ChoiceState
  keyShortcuts: string
  onClick: () => void
}

// A plain <button> rather than Button: Button has a fixed height and does not
// wrap, and these need to grow for long names.
function ChoiceButton({
  person,
  expected,
  delta,
  showRatings,
  state,
  keyShortcuts,
  onClick,
}: ChoiceButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      // aria-disabled instead of disabled keeps keyboard focus on the button
      // while the next pair loads into it.
      aria-disabled={state === 'dimmed' || undefined}
      aria-keyshortcuts={keyShortcuts}
      className={cx(
        'flex min-h-28 min-w-0 flex-col rounded-lg border bg-zinc-900 p-3 text-left transition-colors duration-150 sm:p-4',
        state === 'chosen'
          ? 'border-zinc-300'
          : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/60 active:bg-zinc-800',
        state === 'dimmed' && 'pointer-events-none opacity-50'
      )}
    >
      <span className="text-xs font-medium text-zinc-400">{person.rank}</span>
      <span className="mt-0.5 break-words text-lg font-semibold leading-snug text-zinc-100">
        {person.name}
      </span>
      {showRatings ? (
        <span className="mt-auto flex flex-col gap-0.5 pt-3 text-xs text-zinc-400">
          <RatingLine label="Rating">{formatRating(person.current_elo)}</RatingLine>
          <RatingLine label="Expected">{formatProbability(expected)}</RatingLine>
          <RatingLine label="If picked">
            <Delta value={delta} />
          </RatingLine>
        </span>
      ) : null}
    </button>
  )
}

export interface MatchupPanelProps {
  next: NextMatchupReady
  /** Ignore input: a request is in flight or the pair may be out of date. */
  disabled: boolean
  /** Keyboard shortcuts are also paused while, for example, a confirm is open. */
  shortcutsEnabled: boolean
  /** The control whose request is in flight. It stays highlighted while the rest dim. */
  pending: Choice | null
  showRatings: boolean
  onShowRatingsChange: (value: boolean) => void
  onChoose: (choice: Choice) => void
}

/** The two people to compare, plus Draw and Skip. */
export function MatchupPanel({
  next,
  disabled,
  shortcutsEnabled,
  pending,
  showRatings,
  onShowRatingsChange,
  onChoose,
}: MatchupPanelProps) {
  const promptId = useId()
  useRateShortcuts(shortcutsEnabled && !disabled, onChoose)

  function stateOf(choice: Choice): ChoiceState {
    if (pending === choice) return 'chosen'
    return disabled ? 'dimmed' : 'idle'
  }

  const { person_a: a, person_b: b, expected, preview } = next

  return (
    <div className="space-y-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 id={promptId} className="text-sm font-medium text-zinc-300">
          Who performed better?
        </h2>
        <Button
          size="sm"
          aria-pressed={showRatings}
          onClick={() => onShowRatingsChange(!showRatings)}
          className="aria-pressed:bg-zinc-800 aria-pressed:text-zinc-100"
        >
          Show ratings
        </Button>
      </div>
      <div role="group" aria-labelledby={promptId} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <ChoiceButton
            person={a}
            expected={expected.a}
            delta={preview.a_wins.a}
            showRatings={showRatings}
            state={stateOf('a')}
            keyShortcuts="ArrowLeft 1"
            onClick={() => onChoose('a')}
          />
          <ChoiceButton
            person={b}
            expected={expected.b}
            delta={preview.b_wins.b}
            showRatings={showRatings}
            state={stateOf('b')}
            keyShortcuts="ArrowRight 2"
            onClick={() => onChoose('b')}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            className="w-full"
            aria-keyshortcuts="D"
            aria-disabled={stateOf('draw') === 'dimmed' || undefined}
            onClick={() => onChoose('draw')}
          >
            Draw
          </Button>
          <Button
            size="lg"
            className="w-full"
            aria-keyshortcuts="S"
            aria-disabled={stateOf('skip') === 'dimmed' || undefined}
            onClick={() => onChoose('skip')}
          >
            Skip
          </Button>
        </div>
      </div>
    </div>
  )
}

function ArrowKey({ direction }: { direction: 'left' | 'right' }) {
  return (
    <Kbd>
      <span aria-hidden="true">{direction === 'left' ? '←' : '→'}</span>
      <span className="sr-only">{direction === 'left' ? 'Left arrow' : 'Right arrow'}</span>
    </Kbd>
  )
}

/** Keyboard shortcut reminder, shown from the sm breakpoint up. */
export function ShortcutHint() {
  return (
    <p className="hidden text-xs leading-5 text-zinc-400 sm:block">
      Shortcuts: <ArrowKey direction="left" /> or <Kbd>1</Kbd> left, <ArrowKey direction="right" />{' '}
      or <Kbd>2</Kbd> right, <Kbd>D</Kbd> draw, <Kbd>S</Kbd> skip
    </p>
  )
}
