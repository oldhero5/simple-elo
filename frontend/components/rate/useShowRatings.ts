import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'elo-rater.rate.show-ratings'

// Used when localStorage is blocked (private browsing, strict site settings),
// so the toggle still works until the page is closed.
let fallback: boolean | null = null
const listeners = new Set<() => void>()

function read(): boolean {
  if (fallback !== null) return fallback
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab changing the setting.
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

// The server render cannot see localStorage, so it always renders hidden.
function readOnServer(): boolean {
  return false
}

/**
 * Whether the Rate page shows ratings, expected scores and deltas before a
 * vote. Off by default so the numbers do not anchor the rater. Remembered in
 * this browser only.
 */
export function useShowRatings(): [boolean, (value: boolean) => void] {
  const show = useSyncExternalStore(subscribe, read, readOnServer)

  const update = useCallback((value: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value))
      fallback = null
    } catch {
      fallback = value
    }
    listeners.forEach((listener) => listener())
  }, [])

  return [show, update]
}
