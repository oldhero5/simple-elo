import { Skeleton } from '@/components/ui'

/** Placeholder shaped like the rating view, shown until the first load settles. */
export function RateSkeleton() {
  return (
    <div>
      <h1 className="sr-only">Rate</h1>
      <div role="status" aria-label="Loading">
        <div className="space-y-3">
          <div className="space-y-2">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-1 w-full" />
        </div>
        <div className="mt-5 space-y-3">
          <Skeleton className="h-8 w-44" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        </div>
      </div>
    </div>
  )
}
