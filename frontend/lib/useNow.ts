import { useSyncExternalStore } from 'react'

const TICK_MS = 30_000

let now = Date.now()
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

function notify(): void {
  now = Date.now()
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === undefined) timer = setInterval(notify, TICK_MS)
  // The module may have been idle; refresh so the first paint is current.
  queueMicrotask(notify)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

function getSnapshot(): number {
  return now
}

/**
 * The current time in ms, shared by every caller and refreshed every 30
 * seconds, so relative times ("3 min ago") stay current and agree with each
 * other. Reading Date.now() during render directly would make renders impure.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
