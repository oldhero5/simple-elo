import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import Navigation from '@/components/Navigation'

import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Elo Rater',
    template: '%s | Elo Rater',
  },
  description: 'Pairwise Elo ratings for a team.',
  applicationName: 'Elo Rater',
  appleWebApp: {
    capable: true,
    title: 'Elo Rater',
    statusBarStyle: 'black',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#09090b',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-10"
        >
          Skip to content
        </a>
        <Navigation />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
