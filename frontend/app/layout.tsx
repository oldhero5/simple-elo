import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import Navigation from '@/components/Navigation'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'ELO Performance Rating System',
  description: 'Military-grade performance evaluation using ELO algorithms',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans bg-military-black text-military-light min-h-screen`}>
        <div className="min-h-screen flex flex-col">
          <Navigation />
          <main className="flex-1 container mx-auto px-4 py-8">
            {children}
          </main>
          <footer className="border-t border-military-gray bg-military-dark">
            <div className="container mx-auto px-4 py-4">
              <p className="text-center text-military-muted text-sm font-mono">
                ELO Performance Rating System v1.0 | Military-Grade Evaluation Platform
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
