import {
  type DependencyList,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { type ApiError, isAbortError, toApiError } from './api'

export interface ApiState<T> {
  /** Last successful result. Kept while a reload runs or after a failed reload. */
  data: T | undefined
  /** Error from the most recent load, cleared when a load succeeds. */
  error: ApiError | null
  /** True while any load is in flight, including reloads. */
  loading: boolean
  /** True only before the first load settles: show a skeleton, not the page. */
  initialLoading: boolean
  /** Loads again. The promise settles when that load finishes. */
  reload: () => Promise<void>
  /** Replaces data locally, e.g. after a mutation returns the updated record. */
  setData: (value: SetStateAction<T | undefined>) => void
}

interface LoadState<T> {
  data: T | undefined
  error: ApiError | null
  loading: boolean
  settled: boolean
}

/**
 * Loads data on mount and whenever `deps` change.
 *
 * Old data stays visible while a reload runs, so pages never flash back to a
 * loading screen. A newer load aborts the previous one and stale responses
 * are ignored. The fetcher receives an AbortSignal to pass to the api.ts
 * helper. ESLint checks `deps` like a useEffect dependency list.
 *
 * @example
 * const { data, error, initialLoading, reload } = useApi((signal) => getStats({ signal }), [])
 */
export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList
): ApiState<T> {
  const [state, setState] = useState<LoadState<T>>({
    data: undefined,
    error: null,
    loading: true,
    settled: false,
  })
  const fetcherRef = useRef(fetcher)
  // Layout effects run before the load effect below, so it always sees the latest fetcher.
  useLayoutEffect(() => {
    fetcherRef.current = fetcher
  })
  const latestRequest = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState((prev) => (prev.loading ? prev : { ...prev, loading: true }))
    try {
      const data = await fetcherRef.current(controller.signal)
      if (requestId !== latestRequest.current) return
      setState({ data, error: null, loading: false, settled: true })
    } catch (error) {
      if (requestId !== latestRequest.current || isAbortError(error)) return
      setState((prev) => ({ ...prev, error: toApiError(error), loading: false, settled: true }))
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      latestRequest.current += 1
      controllerRef.current?.abort()
    }
    // The caller's deps decide when to reload; the fetcher itself is read from a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const setData = useCallback((value: SetStateAction<T | undefined>) => {
    setState((prev) => ({
      ...prev,
      data:
        typeof value === 'function'
          ? (value as (previous: T | undefined) => T | undefined)(prev.data)
          : value,
    }))
  }, [])

  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    initialLoading: !state.settled,
    reload: load,
    setData,
  }
}

export type ActionResult<R> = { ok: true; value: R } | { ok: false; error: ApiError | null }

export interface ActionState<A extends unknown[], R> {
  /**
   * Runs the action unless one is already in flight. Never throws: check
   * `result.ok`. A call ignored as a double submit returns `{ ok: false, error: null }`.
   */
  run: (...args: A) => Promise<ActionResult<R>>
  /** True while the action runs. Use it to disable the triggering controls. */
  pending: boolean
  /** Error from the last run, cleared when the next run starts. */
  error: ApiError | null
  clearError: () => void
}

/**
 * Wraps a mutation (submit, save, deactivate) with a double-submit guard,
 * a pending flag and an error for the UI.
 *
 * The guard uses a ref, so a second tap before React re-renders the disabled
 * button is still ignored.
 *
 * @example
 * const vote = useAction(submitResult)
 * const result = await vote.run(matchup.id, winnerId)
 * if (result.ok) setLastRating(result.value.rating)
 */
export function useAction<A extends unknown[], R>(
  action: (...args: A) => Promise<R>
): ActionState<A, R> {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const inFlight = useRef(false)
  const actionRef = useRef(action)
  useLayoutEffect(() => {
    actionRef.current = action
  })

  const run = useCallback(async (...args: A): Promise<ActionResult<R>> => {
    if (inFlight.current) return { ok: false, error: null }
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const value = await actionRef.current(...args)
      return { ok: true, value }
    } catch (caught) {
      const apiError = toApiError(caught)
      setError(apiError)
      return { ok: false, error: apiError }
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { run, pending, error, clearError }
}
