import type { Metadata } from 'next'

import { PersonnelManager } from '@/components/personnel/PersonnelManager'

export const metadata: Metadata = {
  title: 'Personnel',
}

export default function PersonnelPage() {
  return <PersonnelManager />
}
