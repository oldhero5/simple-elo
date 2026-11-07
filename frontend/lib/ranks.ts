/**
 * The single list of ranks offered in rank pickers. The backend stores rank
 * as free text (1..12 characters), so data may contain codes not listed here;
 * RankSelect in components/ui.tsx keeps such a value selectable.
 */

export type RankGroup = 'Enlisted' | 'Officers'

export interface Rank {
  /** Stored value and short form shown in tables, e.g. "SPC". */
  code: string
  /** Full title, e.g. "Specialist". */
  title: string
  group: RankGroup
}

export const RANKS: readonly Rank[] = [
  { code: 'PVT', title: 'Private', group: 'Enlisted' },
  { code: 'PFC', title: 'Private First Class', group: 'Enlisted' },
  { code: 'SPC', title: 'Specialist', group: 'Enlisted' },
  { code: 'CPL', title: 'Corporal', group: 'Enlisted' },
  { code: 'SGT', title: 'Sergeant', group: 'Enlisted' },
  { code: 'SSG', title: 'Staff Sergeant', group: 'Enlisted' },
  { code: 'SFC', title: 'Sergeant First Class', group: 'Enlisted' },
  { code: 'MSG', title: 'Master Sergeant', group: 'Enlisted' },
  { code: 'SGM', title: 'Sergeant Major', group: 'Enlisted' },
  { code: '2LT', title: 'Second Lieutenant', group: 'Officers' },
  { code: '1LT', title: 'First Lieutenant', group: 'Officers' },
  { code: 'CPT', title: 'Captain', group: 'Officers' },
  { code: 'MAJ', title: 'Major', group: 'Officers' },
  { code: 'LTC', title: 'Lieutenant Colonel', group: 'Officers' },
  { code: 'COL', title: 'Colonel', group: 'Officers' },
  { code: 'BG', title: 'Brigadier General', group: 'Officers' },
  { code: 'MG', title: 'Major General', group: 'Officers' },
  { code: 'LTG', title: 'Lieutenant General', group: 'Officers' },
  { code: 'GEN', title: 'General', group: 'Officers' },
]

/** Ranks split into the groups used for <optgroup>, in display order. */
export const RANK_GROUPS: ReadonlyArray<{ label: RankGroup; ranks: readonly Rank[] }> = (
  ['Enlisted', 'Officers'] as const
).map((label) => ({ label, ranks: RANKS.filter((rank) => rank.group === label) }))

/** Preselected rank for new people. */
export const DEFAULT_RANK = 'SPC'

/** Full title for a rank code, or undefined when the code is not in RANKS. */
export function rankTitle(code: string): string | undefined {
  return RANKS.find((rank) => rank.code === code)?.title
}

export function isKnownRank(code: string): boolean {
  return RANKS.some((rank) => rank.code === code)
}
