import type { Personnel } from '@/lib/types'

/** The backend accepts names of 1..80 characters after trimming. */
export const NAME_MAX_LENGTH = 80

/** Active people first, then inactive; each group by rating (highest first), then name. */
export function sortRoster(people: readonly Personnel[]): Personnel[] {
  return [...people].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      b.current_elo - a.current_elo ||
      a.name.localeCompare(b.name) ||
      a.id - b.id
  )
}

/** Replaces the person with the same id, or appends them if they are new. */
export function upsertPerson(people: readonly Personnel[], person: Personnel): Personnel[] {
  return people.some((existing) => existing.id === person.id)
    ? people.map((existing) => (existing.id === person.id ? person : existing))
    : [...people, person]
}

/** "5 active, 1 inactive", "5 active", or null for an empty roster. */
export function rosterSummary(people: readonly Personnel[]): string | null {
  if (people.length === 0) return null
  const active = people.filter((person) => person.active).length
  const inactive = people.length - active
  return inactive > 0 ? `${active} active, ${inactive} inactive` : `${active} active`
}
