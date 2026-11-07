'use client'

import { type ReactNode, useMemo } from 'react'

import { AddPersonForm } from '@/components/personnel/AddPersonForm'
import { RosterSkeleton } from '@/components/personnel/RosterSkeleton'
import { RosterTable } from '@/components/personnel/RosterTable'
import { rosterSummary, sortRoster, upsertPerson } from '@/components/personnel/roster'
import { EmptyState, ErrorAlert, PageHeader, Section } from '@/components/ui'
import { listPersonnel } from '@/lib/api'
import type { Personnel } from '@/lib/types'
import { useApi } from '@/lib/useApi'

// ErrorAlert's "Try again" is a small button; make it a 40px target on phones.
const PHONE_ALERT = 'max-sm:[&_button]:h-10'

export function PersonnelManager() {
  const { data, error, loading, initialLoading, reload, setData } = useApi(
    (signal) => listPersonnel({ activeOnly: false, signal }),
    []
  )
  const roster = useMemo(() => (data ? sortRoster(data) : undefined), [data])

  // Reloads in the background: the current list stays on screen until the new one arrives.
  function refresh() {
    void reload()
  }

  function handleChange(person: Personnel) {
    if (data) {
      setData((prev) => prev && upsertPerson(prev, person))
    } else {
      // The roster never loaded, so there is no list to patch.
      refresh()
    }
  }

  let description: ReactNode = null
  let content: ReactNode = null
  if (roster) {
    description = rosterSummary(roster)
    content =
      roster.length === 0 ? (
        <EmptyState>No people yet. Add the first person with the form above.</EmptyState>
      ) : (
        <RosterTable people={roster} onChange={handleChange} onStale={refresh} />
      )
  } else if (initialLoading) {
    // An inline placeholder: the description renders inside a <p>, where Skeleton's <div> is invalid.
    description = (
      <span
        aria-hidden="true"
        className="inline-block h-3.5 w-28 rounded bg-zinc-800/60 align-middle"
      />
    )
    content = <RosterSkeleton />
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Personnel" description={description} />
      <Section title="Add a person">
        <AddPersonForm onAdded={handleChange} onConflict={refresh} />
      </Section>
      <Section title="Roster">
        {error ? (
          <ErrorAlert
            error={error}
            onRetry={refresh}
            retrying={loading}
            className={roster ? `mb-3 ${PHONE_ALERT}` : PHONE_ALERT}
          />
        ) : null}
        {content}
      </Section>
    </div>
  )
}
