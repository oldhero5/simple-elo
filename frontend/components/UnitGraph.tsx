'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ByUnit, UnitLink, n0, pct, signed } from '@/lib/api'

interface Props {
  units: ByUnit[]
  links: UnitLink[]
  selected: string | null
  onSelect: (unit: string | null) => void
  /** fractional insets of the drawing area inside the canvas */
  inset: { left: number; right: number; top: number; bottom: number }
  ariaLabel: string
}

interface Placed { unit: ByUnit; x: number; y: number; r: number; phase: number }

// Deterministic force layout. Run once per data set: 20 nodes, ~190 links.
function layout(units: ByUnit[], links: UnitLink[]): { x: number; y: number }[] {
  const n = units.length
  if (n === 0) return []
  const idx = new Map(units.map((u, i) => [u.unit, i]))
  const pos = units.map((_, i) => {
    const a = (i / n) * Math.PI * 2
    return { x: Math.cos(a) * 0.5 + Math.sin(i * 12.9898) * 0.05, y: Math.sin(a) * 0.5 + Math.cos(i * 78.233) * 0.05 }
  })
  const wmax = Math.max(1, ...links.map(l => l.comparisons))
  const edges = links
    .map(l => ({ a: idx.get(l.unit_a), b: idx.get(l.unit_b), w: l.comparisons / wmax }))
    .filter((e): e is { a: number; b: number; w: number } => e.a != null && e.b != null)
  for (let it = 0; it < 300; it++) {
    const cool = 1 - it / 300
    const f = pos.map(() => ({ x: 0, y: 0 }))
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y
        const d2 = Math.max(dx * dx + dy * dy, 0.0004)
        const d = Math.sqrt(d2)
        const rep = 0.012 / d2
        dx /= d; dy /= d
        f[i].x += dx * rep; f[i].y += dy * rep
        f[j].x -= dx * rep; f[j].y -= dy * rep
      }
    }
    for (const e of edges) {
      const dx = pos[e.b].x - pos[e.a].x, dy = pos[e.b].y - pos[e.a].y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.001
      const att = d * (0.05 + 0.9 * e.w * e.w)
      f[e.a].x += (dx / d) * att; f[e.a].y += (dy / d) * att
      f[e.b].x -= (dx / d) * att; f[e.b].y -= (dy / d) * att
    }
    for (let i = 0; i < n; i++) {
      f[i].x -= pos[i].x * 0.05; f[i].y -= pos[i].y * 0.05
      const m = Math.hypot(f[i].x, f[i].y) || 1
      const step = Math.min(m, 0.05) * cool
      pos[i].x += (f[i].x / m) * step; pos[i].y += (f[i].y / m) * step
    }
  }
  const xs = pos.map(p => p.x), ys = pos.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  return pos.map(p => ({
    x: maxX === minX ? 0.5 : (p.x - minX) / (maxX - minX),
    y: maxY === minY ? 0.5 : (p.y - minY) / (maxY - minY),
  }))
}

export default function UnitGraph({ units, links, selected, onSelect, inset, ariaLabel }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const size = useRef({ w: 0, h: 0, dpr: 1 })
  const hoverRef = useRef<string | null>(null)
  const selRef = useRef<string | null>(selected)
  const [hover, setHover] = useState<{ unit: ByUnit; x: number; y: number } | null>(null)
  const placedRef = useRef<Placed[]>([])
  const t0 = useRef<number>(0)

  selRef.current = selected

  const base = useMemo(() => layout(units, links), [units, links])
  const wmax = useMemo(() => Math.max(1, ...links.map(l => l.comparisons)), [links])
  const callout = useMemo(() => {
    let best: ByUnit | null = null
    for (const u of units) {
      if (u.cross_win_rate_change == null) continue
      if (!best || u.cross_win_rate_change > (best.cross_win_rate_change as number)) best = u
    }
    return best && (best.cross_win_rate_change as number) > 0 ? best : null
  }, [units])

  useEffect(() => {
    const cv = canvas.current, box = wrap.current
    if (!cv || !box) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const maxOff = Math.max(1, ...units.map(u => u.officers))
    let raf = 0
    t0.current = performance.now()

    const resize = () => {
      const r = box.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      size.current = { w: r.width, h: r.height, dpr }
      cv.width = Math.round(r.width * dpr)
      cv.height = Math.round(r.height * dpr)
      cv.style.width = `${r.width}px`
      cv.style.height = `${r.height}px`
    }

    const draw = (now: number) => {
      const { w, h, dpr } = size.current
      if (!w) return
      const t = reduce ? 5000 : now - t0.current
      const intro = Math.min(1, t / 1100)
      const ease = 1 - Math.pow(1 - intro, 3)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const ax = w * inset.left, ay = h * inset.top
      const aw = w * (1 - inset.left - inset.right), ah = h * (1 - inset.top - inset.bottom)
      const sel = selRef.current, hov = hoverRef.current

      const placed: Placed[] = units.map((u, i) => {
        const phase = i * 1.7
        const drift = reduce ? 0 : 1
        return {
          unit: u,
          phase,
          r: 4 + 11 * Math.sqrt(u.officers / maxOff),
          x: ax + base[i].x * aw + Math.sin(t * 0.00035 + phase) * 3.5 * drift,
          y: ay + base[i].y * ah + Math.cos(t * 0.0003 + phase * 1.3) * 3.5 * drift,
        }
      })
      placedRef.current = placed
      const at = new Map(placed.map(p => [p.unit.unit, p]))

      // links
      ctx.lineCap = 'round'
      ctx.setLineDash([0.1, 6])
      ctx.lineDashOffset = reduce ? 0 : -t * 0.012
      for (const l of links) {
        const a = at.get(l.unit_a), b = at.get(l.unit_b)
        if (!a || !b) continue
        const k = Math.pow(l.comparisons / wmax, 1.4)
        const on = sel && (l.unit_a === sel || l.unit_b === sel)
        const dim = sel && !on
        ctx.strokeStyle = on ? `rgba(122,235,255,${0.35 + 0.6 * k})` : `rgba(255,255,255,${(dim ? 0.03 : 0.06) + (dim ? 0.12 : 0.55) * k})`
        ctx.lineWidth = on ? 2 + 1.5 * k : 1.4 + 1.2 * k
        ctx.globalAlpha = ease
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      // nodes
      ctx.font = '500 10.5px var(--font-geist-mono), ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      placed.forEach((p, i) => {
        const stagger = Math.min(1, Math.max(0, (t - i * 25) / 600))
        const e = 1 - Math.pow(1 - stagger, 3)
        const isSel = sel === p.unit.unit, isHov = hov === p.unit.unit
        const r = p.r * e
        ctx.save()
        if (isSel) { ctx.shadowColor = 'rgba(255,255,255,0.95)'; ctx.shadowBlur = 26 }
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.fillStyle = isSel ? '#fff' : '#0f0f0f'
        ctx.fill()
        ctx.restore()
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
        ctx.lineWidth = isSel || isHov ? 2 : 1.25
        ctx.strokeStyle = isSel || isHov ? '#fff' : 'rgba(255,255,255,0.7)'
        ctx.stroke()
        ctx.fillStyle = isSel ? '#fff' : 'rgba(255,255,255,0.78)'
        ctx.globalAlpha = e
        ctx.fillText(p.unit.unit, p.x, p.y - r - 9)
        ctx.globalAlpha = 1
      })

      // callout on the unit with the biggest rise in cross-unit win rate
      if (callout && intro > 0.6) {
        const p = at.get(callout.unit)
        if (p) {
          const cx = ax + aw / 2, cy = ay + ah / 2
          let dx = p.x - cx, dy = p.y - cy
          const m = Math.hypot(dx, dy) || 1
          dx /= m; dy /= m
          const ex = p.x + dx * (p.r + 34), ey = p.y + dy * (p.r + 34)
          const text1 = `${callout.unit}  ${signed((callout.cross_win_rate_change as number) * 100, 1)} pts`
          // A phone has no room for the second line; the intro above explains it.
          const text2 = w < 520 ? '' : 'cross-unit win rate, early to late'
          ctx.font = '500 11px var(--font-geist-mono), ui-monospace, monospace'
          const tw = Math.max(ctx.measureText(text1).width, ctx.measureText(text2).width)
          const right = ex >= p.x
          let lx = right ? ex + 6 : ex - 6 - tw
          lx = Math.min(Math.max(lx, 6), w - tw - 6)
          const ly = Math.min(Math.max(ey, 20), h - 20)
          ctx.globalAlpha = Math.min(1, (intro - 0.6) / 0.4)
          ctx.strokeStyle = '#7aebff'; ctx.fillStyle = '#7aebff'; ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(p.x + dx * (p.r + 3), p.y + dy * (p.r + 3)); ctx.lineTo(ex, ey)
          ctx.lineTo(right ? lx - 3 : lx + tw + 3, ly); ctx.stroke()
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2); ctx.stroke()
          ctx.textAlign = 'left'
          ctx.fillText(text1, lx, text2 ? ly - 8 : ly + 14)
          ctx.fillStyle = 'rgba(122,235,255,0.85)'
          if (text2) ctx.fillText(text2, lx, ly + 7)
          ctx.textAlign = 'center'
          ctx.globalAlpha = 1
        }
      }
    }

    const loop = (now: number) => { draw(now); raf = requestAnimationFrame(loop) }
    const redraw = () => draw(performance.now())
    resize()
    if (reduce) redraw(); else raf = requestAnimationFrame(loop)
    const ro = new ResizeObserver(() => { resize(); redraw() })
    ro.observe(box)
    const onRedraw = () => { if (reduce) redraw() }
    box.addEventListener('graph-redraw', onRedraw)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); box.removeEventListener('graph-redraw', onRedraw) }
  }, [units, links, base, wmax, callout, inset.left, inset.right, inset.top, inset.bottom])

  useEffect(() => { wrap.current?.dispatchEvent(new Event('graph-redraw')) }, [selected, hover])

  const pick = (e: React.PointerEvent) => {
    const box = wrap.current!.getBoundingClientRect()
    const x = e.clientX - box.left, y = e.clientY - box.top
    let best: Placed | null = null, bd = Infinity
    for (const p of placedRef.current) {
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < p.r + 10 && d < bd) { best = p; bd = d }
    }
    return best ? { p: best, x, y } : null
  }

  return (
    <div ref={wrap} className="absolute inset-0">
      <canvas
        ref={canvas}
        role="img"
        aria-label={ariaLabel}
        className="block cursor-crosshair touch-pan-y"
        onPointerMove={e => {
          const h = pick(e)
          hoverRef.current = h ? h.p.unit.unit : null
          setHover(h ? { unit: h.p.unit, x: h.x, y: h.y } : null)
        }}
        onPointerLeave={() => { hoverRef.current = null; setHover(null) }}
        onClick={e => {
          const h = pick(e as unknown as React.PointerEvent)
          onSelect(h ? (h.p.unit.unit === selected ? null : h.p.unit.unit) : null)
        }}
      />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 border border-line-strong bg-black/90 px-3 py-2 font-mono text-[11px] leading-relaxed tracking-tele text-t1"
          style={{ left: Math.min(hover.x + 14, (wrap.current?.clientWidth ?? 400) - 190), top: Math.max(hover.y - 12, 4) }}
        >
          <div className="uppercase">{hover.unit.unit}</div>
          <div className="text-t2">{n0(hover.unit.officers)} officers</div>
          <div className="text-t2">cross-unit win rate {pct(hover.unit.cross_win_rate)}</div>
          <div className="text-t2">change {hover.unit.cross_win_rate_change == null ? '—' : `${signed(hover.unit.cross_win_rate_change * 100, 1)} pts`}</div>
        </div>
      )}
    </div>
  )
}
