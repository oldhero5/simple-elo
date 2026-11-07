import { useCallback, useSyncExternalStore } from 'react'

/** Tailwind's `sm` breakpoint, for layout that has to change in markup rather than CSS. */
export const SM_UP = '(min-width: 640px)'

/** Whether a CSS media query matches, kept in sync as the viewport changes. False on the server. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query]
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}
