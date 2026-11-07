import { Delta } from '@/components/ui'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import type { PersonRef, Rating } from '@/lib/types'
import { useNow } from '@/lib/useNow'

function Person({ person }: { person: PersonRef }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-zinc-400">{person.rank}</span> {person.name}
    </span>
  )
}

function Deltas({ first, second }: { first: number; second: number }) {
  return (
    <p className="whitespace-nowrap tabular-nums">
      <Delta value={first} />
      <span aria-hidden="true" className="text-zinc-400">
        {' / '}
      </span>
      <span className="sr-only">, </span>
      <Delta value={second} />
    </p>
  )
}

function RatingRow({ rating, now }: { rating: Rating; now: number }) {
  const { person_a: a, person_b: b, winner_id: winnerId } = rating
  const aDelta = rating.a_after - rating.a_before
  const bDelta = rating.b_after - rating.b_before

  let sentence
  let deltas
  if (winnerId === a.id || winnerId === b.id) {
    const aWon = winnerId === a.id
    sentence = (
      <>
        <Person person={aWon ? a : b} /> <span className="text-zinc-400">beat</span>{' '}
        <Person person={aWon ? b : a} />
      </>
    )
    deltas = aWon ? (
      <Deltas first={aDelta} second={bDelta} />
    ) : (
      <Deltas first={bDelta} second={aDelta} />
    )
  } else {
    sentence = (
      <>
        <span className="text-zinc-400">Draw:</span> <Person person={a} />{' '}
        <span className="text-zinc-400">and</span> <Person person={b} />
      </>
    )
    deltas = <Deltas first={aDelta} second={bDelta} />
  }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-3 py-2">
      <p className="min-w-0">{sentence}</p>
      {deltas}
      <time
        dateTime={rating.rated_at}
        title={formatDateTime(rating.rated_at)}
        className="text-xs text-zinc-400"
      >
        {formatRelativeTime(rating.rated_at, now)}
      </time>
    </li>
  )
}

/** The latest votes, newest first, with each side's rating change in name order. */
export function RecentRatings({ ratings }: { ratings: readonly Rating[] }) {
  const now = useNow()
  return (
    <ol className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
      {ratings.map((rating) => (
        <RatingRow key={rating.id} rating={rating} now={now} />
      ))}
    </ol>
  )
}
