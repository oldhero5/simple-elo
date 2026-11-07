import { Skeleton } from '@/components/ui'

const ROWS = 4

/** Placeholder shaped like the roster table, shown only until the first load settles. */
export function RosterSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading roster"
      className="overflow-hidden rounded-lg border border-zinc-800"
    >
      <div className="h-8 border-b border-zinc-800 bg-zinc-900/60" />
      <div className="divide-y divide-zinc-800">
        {Array.from({ length: ROWS }, (_, index) => (
          <div key={index} className="flex h-14 items-center gap-4 px-3 sm:h-12">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="ml-auto h-4 w-12" />
            <Skeleton className="hidden h-4 w-20 sm:block" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}
