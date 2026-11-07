import { formatDelta, formatPerson } from '@/lib/format'
import { type PersonRef, type Rating } from '@/lib/types'

/** Like formatDelta, but a zero reads "+0" so it is clearly a change, not a rating. */
function signedChange(value: number): string {
  const text = formatDelta(value)
  return text === '0' ? '+0' : text
}

/**
 * The sentence announced after a vote, built from the ratings the server
 * actually applied: "CPT Diaz beat SPC Chen. Diaz +16, Chen -16." or
 * "Draw between CPT Diaz and SPC Chen. Diaz +4, Chen -4."
 */
export function describeRating(rating: Rating): string {
  const { person_a: a, person_b: b } = rating
  const aChange = rating.a_after - rating.a_before
  const bChange = rating.b_after - rating.b_before
  // The short name is enough unless both people share it.
  const sameName = a.name.toLowerCase() === b.name.toLowerCase()
  const short = (person: PersonRef) => (sameName ? formatPerson(person) : person.name)

  if (rating.winner_id === null) {
    return (
      `Draw between ${formatPerson(a)} and ${formatPerson(b)}. ` +
      `${short(a)} ${signedChange(aChange)}, ${short(b)} ${signedChange(bChange)}.`
    )
  }
  const aWon = rating.winner_id === a.id
  const [winner, winnerChange, loser, loserChange] = aWon
    ? [a, aChange, b, bChange]
    : [b, bChange, a, aChange]
  return (
    `${formatPerson(winner)} beat ${formatPerson(loser)}. ` +
    `${short(winner)} ${signedChange(winnerChange)}, ${short(loser)} ${signedChange(loserChange)}.`
  )
}

/** "Not recorded." plus the server's reason, as one sentence pair. */
export function notDone(prefix: string, reason: string): string {
  const trimmed = reason.trim()
  return `${prefix} ${/[.?]$/.test(trimmed) ? trimmed : `${trimmed}.`}`
}
