'use client'

import {
  type ChangeEvent,
  type FormEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { NAME_MAX_LENGTH } from '@/components/personnel/roster'
import { SM_UP, useMediaQuery } from '@/components/personnel/useMediaQuery'
import {
  Badge,
  Button,
  Delta,
  Field,
  InlineConfirm,
  Input,
  LiveRegion,
  RankSelect,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/components/ui'
import { updatePersonnel } from '@/lib/api'
import { formatDate, formatPerson, formatRating } from '@/lib/format'
import type { Personnel, PersonnelUpdate } from '@/lib/types'
import { useAction } from '@/lib/useApi'

const COLUMN_COUNT = 7

// The shared buttons are 32-36px tall; on phones every tap target in the roster is 40px.
const PHONE_TAP = 'max-sm:h-10'
const PHONE_CONTROL = 'max-sm:h-10 max-sm:text-base'
// Narrower padding on phones keeps "Edit" and "Deactivate" on one line at 320px wide, so a
// long name wraps instead of every row doubling in height.
const PHONE_ROW_ACTION = 'max-sm:h-10 max-sm:px-2'
const PHONE_CELLS = 'max-sm:[&_td]:px-2 max-sm:[&_th]:px-2'

type Mode =
  | { kind: 'view' }
  | { kind: 'confirm'; id: number }
  | { kind: 'edit'; id: number; name: string; rank: string; error: string | null }

type EditMode = Extract<Mode, { kind: 'edit' }>

/** Elements that can receive focus after a row changes state, marked with data-focus. */
type FocusTarget = 'name' | 'edit' | 'deactivate' | 'reactivate'

function isEditing(mode: Mode, id: number): mode is EditMode {
  return mode.kind === 'edit' && mode.id === id
}

export interface RosterTableProps {
  /** Already in display order. */
  people: readonly Personnel[]
  /** Called with the record the backend returned after an edit, deactivation or reactivation. */
  onChange: (person: Personnel) => void
  /** Called on a 404 or 409, which usually means the roster was changed on another device. */
  onStale?: () => void
}

export function RosterTable({ people, onChange, onStale }: RosterTableProps) {
  const baseId = useId()
  const wide = useMediaQuery(SM_UP)
  const rootRef = useRef<HTMLDivElement>(null)
  // Rows swap their controls when they change state (and may move when re-sorted), so focus
  // is restored after the next render instead of being lost to the page.
  const pendingFocus = useRef<string | null>(null)
  const [mode, setMode] = useState<Mode>({ kind: 'view' })
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const update = useAction(updatePersonnel)
  const busy = update.pending

  useEffect(() => {
    const selector = pendingFocus.current
    if (!selector) return
    const element = rootRef.current?.querySelector<HTMLElement>(selector)
    if (element && !element.matches(':disabled')) {
      pendingFocus.current = null
      element.focus()
    }
  })

  function focusAfterRender(personId: number, target: FocusTarget) {
    pendingFocus.current = `[data-person="${personId}"] [data-focus="${target}"]`
  }

  async function runUpdate(person: Personnel, body: PersonnelUpdate) {
    setRowError(null)
    setAnnouncement('')
    setPendingId(person.id)
    const result = await update.run(person.id, body)
    // A second call while one is in flight is ignored and leaves the first in charge.
    if (!result.ok && result.error === null) return null
    setPendingId(null)
    if (result.ok) {
      onChange(result.value)
    } else if (result.error?.status === 404 || result.error?.status === 409) {
      onStale?.()
    }
    return result
  }

  function startEdit(person: Personnel) {
    setRowError(null)
    setMode({ kind: 'edit', id: person.id, name: person.name, rank: person.rank, error: null })
    focusAfterRender(person.id, 'name')
  }

  function cancelEdit(personId: number) {
    if (busy) return
    setMode({ kind: 'view' })
    focusAfterRender(personId, 'edit')
  }

  function changeDraft(personId: number, changes: Partial<Pick<EditMode, 'name' | 'rank'>>) {
    setMode((prev) => (isEditing(prev, personId) ? { ...prev, ...changes, error: null } : prev))
  }

  async function saveEdit(person: Personnel) {
    if (busy || !isEditing(mode, person.id)) return
    const name = mode.name.trim()
    if (!name) {
      setMode({ ...mode, error: 'Enter a name.' })
      focusAfterRender(person.id, 'name')
      return
    }
    const body: PersonnelUpdate = {}
    if (name !== person.name) body.name = name
    if (mode.rank !== person.rank) body.rank = mode.rank
    if (body.name === undefined && body.rank === undefined) {
      cancelEdit(person.id)
      return
    }
    const result = await runUpdate(person, body)
    if (!result) return
    if (result.ok) {
      setMode((prev) => (isEditing(prev, person.id) ? { kind: 'view' } : prev))
      focusAfterRender(person.id, 'edit')
      setAnnouncement(`Saved ${formatPerson(result.value)}.`)
    } else if (result.error) {
      const message = result.error.message
      setMode((prev) => (isEditing(prev, person.id) ? { ...prev, error: message } : prev))
      focusAfterRender(person.id, 'name')
    }
  }

  function askDeactivate(person: Personnel) {
    setRowError(null)
    // InlineConfirm focuses its Cancel button itself.
    pendingFocus.current = null
    setMode({ kind: 'confirm', id: person.id })
  }

  function cancelDeactivate(personId: number) {
    setMode({ kind: 'view' })
    focusAfterRender(personId, 'deactivate')
  }

  async function confirmDeactivate(person: Personnel) {
    const result = await runUpdate(person, { active: false })
    if (!result) return
    setMode((prev) => (prev.kind === 'confirm' && prev.id === person.id ? { kind: 'view' } : prev))
    if (result.ok) {
      focusAfterRender(person.id, 'reactivate')
      setAnnouncement(`Deactivated ${formatPerson(result.value)}.`)
    } else if (result.error) {
      setRowError({ id: person.id, message: result.error.message })
      focusAfterRender(person.id, 'deactivate')
    }
  }

  async function reactivate(person: Personnel) {
    setMode({ kind: 'view' })
    const result = await runUpdate(person, { active: true })
    if (!result) return
    if (result.ok) {
      focusAfterRender(person.id, 'edit')
      setAnnouncement(`Reactivated ${formatPerson(result.value)}. They join from the next round.`)
    } else if (result.error) {
      setRowError({ id: person.id, message: result.error.message })
      focusAfterRender(person.id, 'reactivate')
    }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLElement>, person: Personnel) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit(person.id)
    } else if (event.key === 'Enter' && event.target instanceof HTMLSelectElement) {
      // Enter in the name field submits the form natively; a select needs it done by hand.
      event.preventDefault()
      void saveEdit(person)
    }
  }

  function handleEditSubmit(event: FormEvent<HTMLFormElement>, person: Personnel) {
    event.preventDefault()
    void saveEdit(person)
  }

  function renderNameExtras(person: Personnel) {
    return (
      <>
        {person.active ? null : <Badge className="ml-2 align-middle sm:hidden">Inactive</Badge>}
        {rowError?.id === person.id ? (
          <p role="alert" className="mt-1 text-sm text-rose-300">
            {rowError.message}
          </p>
        ) : null}
      </>
    )
  }

  function renderDetailCells(person: Personnel) {
    return (
      <>
        <TD numeric>{formatRating(person.current_elo)}</TD>
        <TD numeric hideOnMobile>
          <Delta value={person.current_elo - person.initial_elo} />
        </TD>
        <TD hideOnMobile className="whitespace-nowrap text-zinc-400">
          <time dateTime={person.created_at}>{formatDate(person.created_at)}</time>
        </TD>
        <TD hideOnMobile>{person.active ? 'Active' : 'Inactive'}</TD>
      </>
    )
  }

  function renderActions(person: Personnel) {
    const pending = pendingId === person.id
    if (!person.active) {
      return (
        <Button
          size="sm"
          variant="ghost"
          data-focus="reactivate"
          loading={pending}
          disabled={busy}
          onClick={() => void reactivate(person)}
          className={PHONE_ROW_ACTION}
        >
          Reactivate<span className="sr-only"> {formatPerson(person)}</span>
        </Button>
      )
    }
    if (mode.kind === 'confirm' && mode.id === person.id) {
      return (
        <InlineConfirm
          message="Deactivate?"
          onConfirm={() => void confirmDeactivate(person)}
          onCancel={() => cancelDeactivate(person.id)}
          pending={pending}
          className="justify-end max-sm:[&_button]:h-10"
        />
      )
    }
    return (
      <div className="inline-flex justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          data-focus="edit"
          disabled={busy}
          onClick={() => startEdit(person)}
          className={PHONE_ROW_ACTION}
        >
          Edit<span className="sr-only"> {formatPerson(person)}</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-focus="deactivate"
          disabled={busy}
          onClick={() => askDeactivate(person)}
          className={PHONE_ROW_ACTION}
        >
          Deactivate<span className="sr-only"> {formatPerson(person)}</span>
        </Button>
      </div>
    )
  }

  function renderEditRow(person: Personnel, draft: EditMode) {
    const saving = pendingId === person.id
    const formId = `${baseId}-edit-${person.id}`
    const nameId = `${formId}-name`
    const rankId = `${formId}-rank`
    const errorId = `${formId}-error`
    // Shared by the phone and desktop layouts below.
    const nameProps: InputHTMLAttributes<HTMLInputElement> & { 'data-focus': FocusTarget } = {
      id: nameId,
      value: draft.name,
      onChange: (event) => changeDraft(person.id, { name: event.target.value }),
      maxLength: NAME_MAX_LENGTH,
      autoComplete: 'off',
      autoCapitalize: 'words',
      spellCheck: false,
      enterKeyHint: 'done',
      readOnly: saving,
      'data-focus': 'name',
      'aria-invalid': draft.error ? true : undefined,
      'aria-describedby': draft.error ? errorId : undefined,
    }
    const rankProps = {
      id: rankId,
      value: draft.rank,
      onChange: (event: ChangeEvent<HTMLSelectElement>) =>
        changeDraft(person.id, { rank: event.target.value }),
    }
    const error = draft.error ? (
      <p id={errorId} role="alert" className="text-sm text-rose-300">
        {draft.error}
      </p>
    ) : null

    if (!wide) {
      // Phones: the whole row becomes a full-width form so the inputs are usable.
      return (
        <TR key={person.id} data-person={person.id}>
          <TD colSpan={COLUMN_COUNT} className="py-3">
            <form
              noValidate
              aria-label={`Edit ${formatPerson(person)}`}
              onSubmit={(event) => handleEditSubmit(event, person)}
              onKeyDown={(event) => handleEditKeyDown(event, person)}
              className="space-y-3"
            >
              <Field label="Name" htmlFor={nameId}>
                <Input {...nameProps} className={PHONE_CONTROL} />
              </Field>
              <Field label="Rank" htmlFor={rankId}>
                <RankSelect {...rankProps} className={PHONE_CONTROL} />
              </Field>
              {error}
              <div className="flex gap-2">
                <Button type="submit" variant="secondary" loading={saving} className={PHONE_TAP}>
                  Save
                </Button>
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => cancelEdit(person.id)}
                  className={PHONE_TAP}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </TD>
        </TR>
      )
    }

    // Wider screens: inputs replace the name and rank cells. The form lives in the actions
    // cell and the inputs join it through the form attribute, so Enter still submits.
    return (
      <TR
        key={person.id}
        data-person={person.id}
        onKeyDown={(event) => handleEditKeyDown(event, person)}
      >
        <TD>
          <Input
            {...nameProps}
            form={formId}
            aria-label={`Name for ${formatPerson(person)}`}
            className="min-w-40"
          />
          {error ? <div className="mt-1">{error}</div> : null}
        </TD>
        <TD hideOnMobile>
          <RankSelect
            {...rankProps}
            form={formId}
            labels="code"
            aria-label={`Rank for ${formatPerson(person)}`}
            className="min-w-24"
          />
        </TD>
        {renderDetailCells(person)}
        <TD align="right">
          <form
            id={formId}
            noValidate
            onSubmit={(event) => handleEditSubmit(event, person)}
            className="inline-flex justify-end gap-1"
          >
            <Button type="submit" size="sm" variant="secondary" loading={saving}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => cancelEdit(person.id)}
            >
              Cancel
            </Button>
          </form>
        </TD>
      </TR>
    )
  }

  return (
    <div ref={rootRef}>
      <Table aria-label="Roster" className={PHONE_CELLS}>
        <THead>
          <TR>
            <TH>Name</TH>
            <TH hideOnMobile>Rank</TH>
            <TH numeric>Rating</TH>
            <TH numeric hideOnMobile>
              Change<span className="sr-only"> since added</span>
            </TH>
            <TH hideOnMobile>Added</TH>
            <TH hideOnMobile>Status</TH>
            <TH align="right">
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {people.map((person) =>
            isEditing(mode, person.id) ? (
              renderEditRow(person, mode)
            ) : (
              <TR key={person.id} muted={!person.active} data-person={person.id}>
                <TD className="[overflow-wrap:anywhere]">
                  {/* The Rank column is hidden on phones, so the rank leads the name there. */}
                  <span className="text-zinc-400 sm:hidden">{person.rank} </span>
                  {person.name}
                  {renderNameExtras(person)}
                </TD>
                <TD hideOnMobile>{person.rank}</TD>
                {renderDetailCells(person)}
                <TD align="right">{renderActions(person)}</TD>
              </TR>
            )
          )}
        </TBody>
      </Table>
      <LiveRegion className="sr-only">{announcement}</LiveRegion>
    </div>
  )
}
