'use client'

import { ErrorAlert, PageHeader } from '@/components/ui'

/** Shown when a page throws while rendering. API failures are handled inline by each page. */
export default function PageError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="space-y-6">
      <PageHeader title="Something went wrong" />
      <ErrorAlert error="This page could not be displayed." onRetry={reset} />
    </div>
  )
}
