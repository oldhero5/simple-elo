import { useEffect, useLayoutEffect, useRef } from 'react'

export type Choice = 'a' | 'b' | 'draw' | 'skip'

const KEYS: Partial<Record<string, Choice>> = {
  ArrowLeft: 'a',
  '1': 'a',
  ArrowRight: 'b',
  '2': 'b',
  d: 'draw',
  D: 'draw',
  s: 'skip',
  S: 'skip',
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('input, textarea, select') !== null)
  )
}

/**
 * Left arrow or 1 picks the left person, right arrow or 2 the right one,
 * D records a draw and S skips. Keys are ignored while `enabled` is false,
 * while typing in a form control, with a modifier held, and on auto-repeat
 * (holding a key down would otherwise vote on every pair that loads).
 */
export function useRateShortcuts(enabled: boolean, onChoose: (choice: Choice) => void): void {
  const enabledRef = useRef(enabled)
  const onChooseRef = useRef(onChoose)
  // Keep the latest values for the long-lived listener without re-subscribing.
  useLayoutEffect(() => {
    enabledRef.current = enabled
    onChooseRef.current = onChoose
  })

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!enabledRef.current || event.defaultPrevented || event.repeat || event.isComposing) {
        return
      }
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (isEditable(event.target)) return
      const choice = KEYS[event.key]
      if (!choice) return
      event.preventDefault()
      onChooseRef.current(choice)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
