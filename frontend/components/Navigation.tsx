'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, Users, Target, BarChart3 } from 'lucide-react'

const navItems = [
  { href: '/', label: 'Dashboard', icon: BarChart3 },
  { href: '/rate', label: 'Rate Personnel', icon: Target },
  { href: '/personnel', label: 'Manage Personnel', icon: Users },
]

export default function Navigation() {
  const pathname = usePathname()

  return (
    <nav className="bg-military-dark border-b border-military-gray">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-2">
            <Activity className="h-8 w-8 text-military-green" />
            <h1 className="text-xl font-bold font-mono text-military-light">
              ELO RATER
            </h1>
          </div>

          <div className="hidden md:block">
            <div className="ml-10 flex items-baseline space-x-4">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                      isActive
                        ? 'bg-military-green text-white'
                        : 'text-military-muted hover:text-military-light hover:bg-military-gray'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>

          <div className="md:hidden">
            <div className="flex space-x-2">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`p-2 rounded-md transition-colors duration-200 ${
                      isActive
                        ? 'bg-military-green text-white'
                        : 'text-military-muted hover:text-military-light hover:bg-military-gray'
                    }`}
                    title={item.label}
                  >
                    <Icon className="h-5 w-5" />
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}
