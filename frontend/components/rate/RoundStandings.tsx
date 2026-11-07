import { Delta, EmptyState, Section, TBody, TD, TH, THead, TR, Table } from '@/components/ui'
import { formatPerson, formatRating } from '@/lib/format'
import { type RoundDetail } from '@/lib/types'

/** Final standings of a finished round: start, final and change per person. */
export function RoundStandings({ detail }: { detail: RoundDetail }) {
  const { round, standings } = detail
  return (
    <Section title="Standings">
      {standings.length === 0 ? (
        <EmptyState>Nobody took part in this round.</EmptyState>
      ) : (
        <Table aria-label={`${round.name} standings`}>
          <THead>
            <TR>
              <TH numeric className="w-10">
                #
              </TH>
              <TH>Name</TH>
              <TH numeric hideOnMobile>
                Start
              </TH>
              <TH numeric>Final</TH>
              <TH numeric>Change</TH>
            </TR>
          </THead>
          <TBody>
            {standings.map((row, index) => (
              <TR key={row.id}>
                <TD numeric className="text-zinc-400">
                  {index + 1}
                </TD>
                <TD className="[overflow-wrap:anywhere]">{formatPerson(row)}</TD>
                <TD numeric hideOnMobile className="text-zinc-400">
                  {formatRating(row.starting_elo)}
                </TD>
                <TD numeric className="font-medium">
                  {formatRating(row.final_elo)}
                </TD>
                <TD numeric>
                  <Delta value={row.change} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  )
}
