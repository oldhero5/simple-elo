'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cx } from '@/lib/cx'

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/rate', label: 'Rate' },
  { href: '/personnel', label: 'Personnel' },
] as const

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Site header: wordmark on the left, the same text links on every screen size. */
export default function Navigation() {
  const pathname = usePathname() ?? '/'

  return (
    <header className="border-b border-zinc-800">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="shrink-0 text-sm font-semibold text-zinc-100">
          Elo Rater
        </Link>
        <nav aria-label="Main">
          <ul className="flex items-center gap-0.5 sm:gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'inline-flex h-8 items-center rounded-md px-2 text-sm transition-colors duration-150 sm:px-3',
                      active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100'
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
    </header>
  )
}
