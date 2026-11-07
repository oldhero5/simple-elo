import { Skeleton } from '@/components/ui'

// Only the last two stats (current round, leader) usually carry a hint line.
const STAT_HAS_HINT = [false, false, true, true]
const TABLE_ROWS = 5

/** Placeholder shaped like the stat strip and the standings table. */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard" className="space-y-8">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 sm:grid-cols-4">
        {STAT_HAS_HINT.map((hasHint, index) => (
          <div key={index} className="bg-zinc-950 px-4 py-3">
            <Skeleton className="my-0.5 h-3 w-14" />
            <Skeleton className="mb-1 mt-2 h-5 w-20" />
            {hasHint ? <Skeleton className="mt-1.5 h-3 w-16" /> : null}
          </div>
        ))}
      </div>
      <div>
        <div className="mb-3 flex h-8 items-center">
          <Skeleton className="h-3.5 w-20" />
        </div>
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <div className="h-8 border-b border-zinc-800 bg-zinc-900/60" />
          <div className="divide-y divide-zinc-800">
            {Array.from({ length: TABLE_ROWS }, (_, index) => (
              <div key={index} className="flex h-9 items-center gap-4 px-3">
                <Skeleton className="h-3.5 w-5" />
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="ml-auto h-3.5 w-10" />
                <Skeleton className="h-3.5 w-8" />
                <Skeleton className="hidden h-3.5 w-10 sm:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
