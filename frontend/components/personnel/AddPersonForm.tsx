'use client'

import { type FormEvent, useId, useRef, useState } from 'react'

import { NAME_MAX_LENGTH } from '@/components/personnel/roster'
import { Button, Field, Input, LiveRegion, RankSelect } from '@/components/ui'
import { createPersonnel } from '@/lib/api'
import { formatPerson } from '@/lib/format'
import { DEFAULT_RANK } from '@/lib/ranks'
import type { Personnel } from '@/lib/types'
import { useAction } from '@/lib/useApi'

// Controls are 40px tall on phones for touch, and 16px text keeps iOS from zooming on focus.
const PHONE_CONTROL = 'max-sm:h-10 max-sm:text-base'

export interface AddPersonFormProps {
  onAdded: (person: Personnel) => void
  /** Called on a 409: the duplicate may have been added on another device, so the list is stale. */
  onConflict?: () => void
}

/** One-row form on desktop, stacked on phones. Typed values survive a failed add. */
export function AddPersonForm({ onAdded, onConflict }: AddPersonFormProps) {
  const id = useId()
  const nameId = `${id}-name`
  const rankId = `${id}-rank`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [rank, setRank] = useState(DEFAULT_RANK)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const add = useAction(createPersonnel)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (add.pending) return
    setStatus('')
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name.')
      nameRef.current?.focus()
      return
    }
    setError(null)
    const result = await add.run({ name: trimmed, rank })
    if (result.ok) {
      onAdded(result.value)
      setName('')
      setRank(DEFAULT_RANK)
      setStatus(`Added ${formatPerson(result.value)}.`)
    } else if (result.error) {
      setError(result.error.message)
      if (result.error.status === 409) onConflict?.()
    } else {
      return
    }
    nameRef.current?.focus()
  }

  return (
    <form noValidate onSubmit={handleSubmit}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Name" htmlFor={nameId} className="sm:flex-1">
          <Input
            ref={nameRef}
            id={nameId}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
              setStatus('')
            }}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="done"
            readOnly={add.pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            className={PHONE_CONTROL}
          />
        </Field>
        <Field label="Rank" htmlFor={rankId} className="sm:w-64">
          <RankSelect
            id={rankId}
            value={rank}
            onChange={(event) => {
              setRank(event.target.value)
              setError(null)
            }}
            className={PHONE_CONTROL}
          />
        </Field>
        <Button type="submit" variant="primary" loading={add.pending} className="max-sm:h-10">
          Add
        </Button>
      </div>
      <div className="mt-2 space-y-2">
        <p id={hintId} className="text-xs text-zinc-400">
          New people join from the next round.
        </p>
        {error ? (
          <p id={errorId} role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        ) : null}
        <LiveRegion className="text-zinc-400">{status}</LiveRegion>
      </div>
    </form>
  )
}
