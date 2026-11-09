'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Info, X } from 'lucide-react'
import { Meta, useApi } from '@/lib/api'

const items = [
  { href: '/', label: 'Dashboard' },
  { href: '/rate', label: 'Rate' },
  { href: '/replay', label: 'Replay' },
  { href: '/personnel', label: 'Personnel' },
]

function SyntheticStrip() {
  const { data, error, retry } = useApi<Meta>('/api/meta')
  const [open, setOpen] = useState(false)
  if (error) {
    return (
      <div className="border-b border-line bg-black px-4 py-1.5 sm:px-8">
        <span className="tele">Data label unavailable: [API OFFLINE] </span>
        <button onClick={retry} className="tele underline underline-offset-2 hover:text-t1">Retry</button>
      </div>
    )
  }
  if (!data || !data.synthetic) return null
  return (
    <div className="border-b border-amber/40 bg-black">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-1.5 sm:px-8">
        <p className="font-mono text-[11px] uppercase leading-snug tracking-tele text-amber">
          [{'SYNTHETIC'}] {data.label}
        </p>
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-controls="meta-notes"
          className="tele flex shrink-0 items-center gap-1.5 text-t2 hover:text-t1"
        >
          {open ? <X className="h-3 w-3" aria-hidden /> : <Info className="h-3 w-3" aria-hidden />} Notes
        </button>
      </div>
      {open && (
        <div id="meta-notes" className="border-t border-line bg-panel">
          <div className="mx-auto grid max-w-[1440px] gap-x-10 gap-y-2 px-4 py-4 sm:px-8 md:grid-cols-2">
            <p className="tele md:col-span-2">Source: {data.source}</p>
            {data.notes.map(n => (
              <p key={n} className="text-sm text-t2">{n}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Ticker({ label }: { label: string }) {
  return (
    <div className="pointer-events-none hidden select-none items-center gap-3 font-mono text-[11px] uppercase tracking-tele text-t3 lg:flex" aria-hidden>
      <span className="tracking-[0.5em]">| | | |</span>
      <span className="text-t1">{label}</span>
      <span className="tracking-[0.5em]">| | | |</span>
    </div>
  )
}

export default function SiteHeader() {
  const path = usePathname()
  const current = items.find(i => (i.href === '/' ? path === '/' : path.startsWith(i.href))) ?? items[0]
  return (
    <header className="sticky top-0 z-40 bg-black/85 backdrop-blur">
      <SyntheticStrip />
      <div className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-2 px-4 sm:gap-4 sm:px-8">
          <Link href="/" className="whitespace-nowrap text-base font-medium tracking-tightest sm:text-lg">Simple Elo</Link>
          <Ticker label={current.label} />
          <nav aria-label="Primary" className="flex items-center gap-1">
            {items.map(i => {
              const active = i === current
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-full px-2 py-1.5 font-mono text-[10px] sm:text-[11px] uppercase tracking-tele transition-colors sm:px-4 ${
                    active ? 'bg-white text-black' : 'text-t2 hover:bg-white/10 hover:text-t1'
                  }`}
                >
                  {i.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </header>
  )
}
