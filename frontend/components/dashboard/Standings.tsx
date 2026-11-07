import { Delta, TBody, TD, TH, THead, TR, Table } from '@/components/ui'
import { formatRating, formatRecord } from '@/lib/format'
import type { LeaderboardEntry } from '@/lib/types'

/** Competition placings ("1, 2, 2, 4"): people on the same rating share a place. */
function placings(people: readonly LeaderboardEntry[]): number[] {
  return people.map((person, index) => {
    let first = index
    while (first > 0 && people[first - 1].current_elo === person.current_elo) first -= 1
    return first + 1
  })
}

/** Active people by current rating, with the change since their initial rating. */
export function Standings({ people }: { people: readonly LeaderboardEntry[] }) {
  const places = placings(people)

  return (
    <Table aria-label="Standings">
      <THead>
        <TR>
          <TH numeric className="w-12">
            <span aria-hidden="true">#</span>
            <span className="sr-only">Place</span>
          </TH>
          <TH>Name</TH>
          <TH numeric>Rating</TH>
          <TH numeric>
            Change<span className="sr-only"> since start</span>
          </TH>
          <TH numeric hideOnMobile>
            <abbr title="Wins, losses, draws" className="no-underline">
              W-L-D
            </abbr>
          </TH>
        </TR>
      </THead>
      <TBody>
        {people.map((person, index) => (
          <TR key={person.id}>
            <TD numeric className="text-zinc-400">
              {places[index]}
            </TD>
            <TD>
              <span className="text-zinc-400">{person.rank}</span> {person.name}
            </TD>
            <TD numeric>{formatRating(person.current_elo)}</TD>
            <TD numeric>
              <Delta value={person.current_elo - person.initial_elo} />
            </TD>
            <TD numeric hideOnMobile className="text-zinc-300">
              {formatRecord(person.wins, person.losses, person.draws)}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}
