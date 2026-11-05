import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import SiteHeader from '@/components/SiteHeader'

export const metadata: Metadata = {
  title: 'Simple Elo',
  description: 'Pairwise comparisons of officers with a running Elo rating, cut by grade band, unit and time.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:text-black">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-8 sm:px-8">
          {children}
        </main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1440px] flex-wrap justify-between gap-2 px-4 py-6 sm:px-8">
            <span className="tele">Simple Elo prototype</span>
            <span className="tele">Pairwise comparison record, cut by band, unit and time</span>
          </div>
        </footer>
      </body>
    </html>
  )
}
