'use client'

import { AlertTriangle, RotateCw } from 'lucide-react'

export function ErrorRetry({ message, onRetry, label = 'Could not load data' }: { message: string; onRetry: () => void; label?: string }) {
  return (
    <div role="alert" className="border border-alert/60 bg-alert/5 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-alert" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="tele-strong text-alert">{label}: [ERROR]</p>
          <p className="mt-1 break-words text-sm text-t2">{message}. Check that the API is running on port 8000.</p>
        </div>
        <button onClick={onRetry} className="pill-ghost shrink-0 !px-4 !py-1.5">
          <RotateCw className="h-3.5 w-3.5" aria-hidden /> Retry
        </button>
      </div>
    </div>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-6">
      <span className="relative block h-px w-24 overflow-hidden bg-line scanbar" aria-hidden />
      <span className="tele">{label}</span>
    </div>
  )
}

export function Section({ title, aside, children, id }: { title: string; aside?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="rule pt-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 className="display text-2xl sm:text-3xl">{title}</h2>
        {aside && <div className="tele max-w-xl text-left sm:text-right normal-case tracking-normal !text-[13px] !font-sans">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

export function Stat({ label, value, status }: { label: string; value: React.ReactNode; status?: React.ReactNode }) {
  return (
    <div className="border-t border-line py-3">
      <div className="tele">{label}</div>
      <div className="mt-1 font-mono text-2xl tabular-nums tracking-tight">{value}</div>
      {status && <div className="tele mt-1">{status}</div>}
    </div>
  )
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <header className="boot mb-8 flex flex-wrap items-end justify-between gap-6" style={{ ['--i' as string]: 0 }}>
      <div className="max-w-3xl">
        <h1 className="display text-4xl sm:text-6xl">{title}</h1>
        {sub && <p className="mt-4 max-w-2xl text-base text-t2">{sub}</p>}
      </div>
      {children}
    </header>
  )
}
