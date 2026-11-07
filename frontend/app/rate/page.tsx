import type { Metadata } from 'next'

import { RateSession } from '@/components/rate/RateSession'

export const metadata: Metadata = {
  title: 'Rate',
}

export default function RatePage() {
  return <RateSession />
}
