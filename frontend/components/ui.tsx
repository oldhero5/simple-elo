/**
 * Shared UI primitives. Build pages from these instead of ad hoc class strings
 * so every page looks and behaves the same.
 *
 * Design rules: dark zinc UI, no shadows, no icons in text
 * buttons, sentence case, numbers in `tabular-nums`, motion limited to 150ms
 * color transitions. Focus rings come from the global :focus-visible rule in
 * app/globals.css, so do not add `outline-none` anywhere.
 *
 * Layout
 * - PageHeader: one per page. h1 on the left, `actions` on the right, optional
 *   one-line `description`, optional `children` below (e.g. a ProgressBar).
 * - Section: an h2 block with optional `actions`. Stack sections in a
 *   `space-y-8` container.
 * - StatList + Stat: the compact <dl> strip used instead of stat cards.
 * - Table, THead, TBody, TR, TH, TD: the one table style. TH/TD take
 *   `hideOnMobile` (hidden below sm) and `align`; TD takes `numeric`.
 * - EmptyState: bordered box with one muted sentence and an optional action.
 *
 * Controls
 * - Button: variants primary | secondary | ghost | danger, sizes sm | md | lg
 *   (lg is a 44px touch target). `loading` disables it and sets aria-busy.
 *   Defaults to type="button"; pass type="submit" inside forms.
 * - LinkButton: a Next <Link> that looks like a Button.
 * - SegmentedControl: a small set of mutually exclusive buttons (aria-pressed).
 * - InlineConfirm: "Deactivate? Yes / Cancel" in place of the original button.
 * - Field, Input, Select, RankSelect: labelled form controls.
 *
 * Feedback
 * - Alert (tone error | info) and ErrorAlert (message plus "Try again").
 * - LiveRegion: render it from the start and change its children; screen
 *   readers announce the change (rating results, form errors).
 * - Skeleton, ProgressBar, Delta, Badge, Kbd.
 *
 * Most primitives forward extra props (id, aria-*, onClick) to their root
 * element. `className` is appended, but it cannot override a property the
 * primitive already sets (see lib/cx.ts), so use the props for that.
 */
import Link from 'next/link'
import {
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
  forwardRef,
} from 'react'

import { type ApiError } from '@/lib/api'
import { cx } from '@/lib/cx'
import { deltaClass, formatDelta } from '@/lib/format'
import { RANK_GROUPS, isKnownRank } from '@/lib/ranks'

// Buttons

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const buttonBase =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ' +
  'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-zinc-100 text-zinc-900 hover:bg-white',
  secondary: 'border border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100',
  ghost: 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
  danger: 'border border-rose-900/60 text-rose-400 hover:bg-rose-950/40 hover:text-rose-300',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-sm',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-11 px-4 text-sm',
}

/** Class string for anything that should look like a Button. */
export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cx(buttonBase, buttonVariants[variant], buttonSizes[size], className)
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin"
      fill="none"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Default "secondary". Use one "primary" per view. */
  variant?: ButtonVariant
  /** Default "md" (36px). "lg" is 44px tall for touch-first controls. */
  size?: ButtonSize
  /** Disables the button, shows a small spinner and sets aria-busy. */
  loading?: boolean
}

/** A real <button>. Defaults to type="button". */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled,
    className,
    children,
    type,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  )
})

export type LinkButtonProps = ComponentPropsWithoutRef<typeof Link> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

/** A Next.js <Link> styled as a Button, for actions that navigate. */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: LinkButtonProps) {
  return <Link className={buttonClasses({ variant, size, className })} {...props} />
}

// Layout

export interface PageHeaderProps {
  title: ReactNode
  /** One muted line, only when it tells the user something they need. */
  description?: ReactNode
  /** Right-aligned controls, usually one primary Button or LinkButton. */
  actions?: ReactNode
  /** Rendered under the title row, e.g. a ProgressBar. */
  children?: ReactNode
  className?: string
}

/** The page's single h1 row. */
export function PageHeader({ title, description, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cx('space-y-3', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">{title}</h1>
          {description ? <p className="mt-1 text-sm text-zinc-400">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  )
}

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  /** Small controls on the right of the heading, e.g. a SegmentedControl. */
  actions?: ReactNode
  children: ReactNode
}

/** A titled block of the page (h2). */
export function Section({ title, actions, children, className, ...props }: SectionProps) {
  return (
    <section className={className} {...props}>
      <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-sm font-medium text-zinc-300">{title}</h2>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

const statColumns = {
  2: 'grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
} as const

export interface StatListProps extends HTMLAttributes<HTMLDListElement> {
  /** Columns from sm up. 4 shows as 2x2 on phones. Default 4. */
  columns?: keyof typeof statColumns
}

/** A divided strip of label/value pairs. Children are Stat elements. */
export function StatList({ columns = 4, className, children, ...props }: StatListProps) {
  return (
    <dl
      className={cx(
        'grid gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800',
        statColumns[columns],
        className
      )}
      {...props}
    >
      {children}
    </dl>
  )
}

export interface StatProps {
  label: ReactNode
  value: ReactNode
  /** Optional muted line under the value. */
  hint?: ReactNode
}

/** One label/value pair inside StatList. Long values truncate. */
export function Stat({ label, value, hint }: StatProps) {
  return (
    <div className="min-w-0 bg-zinc-950 px-4 py-3">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className="mt-1 truncate text-lg font-semibold tabular-nums text-zinc-100">{value}</dd>
      {hint ? <dd className="mt-0.5 truncate text-xs text-zinc-400">{hint}</dd> : null}
    </div>
  )
}

// Tables

type Align = 'left' | 'center' | 'right'

const alignClasses: Record<Align, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

/**
 * The bordered table container. Give it an aria-label (or a caption) when the
 * surrounding Section title does not already describe it.
 */
export function Table({ className, children, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className={cx('w-full border-collapse text-sm', className)} {...props}>
        {children}
      </table>
    </div>
  )
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cx('border-b border-zinc-800 bg-zinc-900/60 text-xs text-zinc-400', className)}
      {...props}
    />
  )
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cx('divide-y divide-zinc-800', className)} {...props} />
}

export interface TRProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Dims the row's text, e.g. for inactive people. */
  muted?: boolean
}

export function TR({ muted, className, ...props }: TRProps) {
  return <tr className={cx(muted && 'text-zinc-400', className)} {...props} />
}

export interface THProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Default "left", or "right" when numeric. Match the column's TDs. */
  align?: Align
  /** Hide below the sm breakpoint. Use the same flag on the column's TDs. */
  hideOnMobile?: boolean
  /** Right-aligns the header to sit over a numeric TD column. */
  numeric?: boolean
}

/** Column header. Defaults to scope="col". */
export function TH({ align, hideOnMobile, numeric, className, scope, ...props }: THProps) {
  return (
    <th
      scope={scope ?? 'col'}
      className={cx(
        'px-3 py-2 font-medium',
        alignClasses[align ?? (numeric ? 'right' : 'left')],
        hideOnMobile && 'hidden sm:table-cell',
        className
      )}
      {...props}
    />
  )
}

export interface TDProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** Default "left", or "right" when numeric. */
  align?: Align
  hideOnMobile?: boolean
  /** Right-aligned tabular figures for ratings, counts and deltas. */
  numeric?: boolean
}

export function TD({ align, hideOnMobile, numeric, className, ...props }: TDProps) {
  return (
    <td
      className={cx(
        'px-3 py-2',
        alignClasses[align ?? (numeric ? 'right' : 'left')],
        numeric && 'tabular-nums',
        hideOnMobile && 'hidden sm:table-cell',
        className
      )}
      {...props}
    />
  )
}

// Feedback

export interface DeltaProps extends HTMLAttributes<HTMLSpanElement> {
  value: number
}

/** A colored, signed rating change: "+16", "-16" or "0". */
export function Delta({ value, className, ...props }: DeltaProps) {
  return (
    <span className={cx('tabular-nums', deltaClass(value), className)} {...props}>
      {formatDelta(value)}
    </span>
  )
}

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  /** "error" announces immediately (role=alert); "info" politely (role=status). */
  tone?: 'error' | 'info'
  /** A small control on the right, e.g. a "Try again" Button size="sm". */
  action?: ReactNode
  children: ReactNode
}

/** A slim inline message row. */
export function Alert({ tone = 'info', action, children, className, ...props }: AlertProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border px-3 py-2 text-sm',
        tone === 'error'
          ? 'border-rose-900/60 bg-rose-950/30 text-rose-200'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-300',
        className
      )}
      {...props}
    >
      <div className="min-w-0">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export interface ErrorAlertProps {
  /** Renders nothing when null or undefined. */
  error: ApiError | Error | string | null | undefined
  /** Shows a "Try again" button that calls this. */
  onRetry?: () => void
  /** Disables "Try again" while a retry is in flight. */
  retrying?: boolean
  className?: string
}

/** The standard error row: the actual message plus an optional "Try again". */
export function ErrorAlert({ error, onRetry, retrying, className }: ErrorAlertProps) {
  if (!error) return null
  const message = typeof error === 'string' ? error : error.message
  return (
    <Alert
      tone="error"
      className={className}
      action={
        onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry} loading={retrying}>
            Try again
          </Button>
        ) : null
      }
    >
      {message}
    </Alert>
  )
}

export interface LiveRegionProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

/**
 * A polite live region. Keep it mounted and change its children; announcing
 * only works when the region already exists before the text changes.
 */
export function LiveRegion({ className, children, ...props }: LiveRegionProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cx('text-sm text-zinc-300', className)}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * A neutral placeholder block. Size it with className (e.g. "h-4 w-32") to
 * match the content it stands in for. Wrap a group of skeletons in an element
 * with role="status" and aria-label="Loading".
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('rounded bg-zinc-800/60', className)} />
}

export interface ProgressBarProps {
  value: number
  max: number
  /** Accessible name, e.g. "Round progress". */
  label: string
  className?: string
}

/** A 4px progress track. */
export function ProgressBar({ value, max, label, className }: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), Math.max(max, 0))
  const percent = max > 0 ? (clamped / max) * 100 : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamped}
      className={cx('h-1 w-full overflow-hidden rounded-full bg-zinc-800', className)}
    >
      <div
        className="h-full rounded-full bg-zinc-100 transition-[width] duration-150 motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  /** Accessible name for the group, e.g. "Chart view". */
  label: string
  className?: string
}

/** Two to four mutually exclusive buttons. The selected one has aria-pressed=true. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx('inline-flex rounded-md border border-zinc-800 p-0.5', className)}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              if (!selected) onChange(option.value)
            }}
            className={cx(
              'h-7 rounded px-2.5 text-xs font-medium transition-colors duration-150',
              selected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export interface EmptyStateProps {
  /** One sentence. */
  children: ReactNode
  /** Optional single action, e.g. a LinkButton. */
  action?: ReactNode
  /** "center" for fixed-height placeholders such as an empty chart. Default "start". */
  align?: 'start' | 'center'
  /** Use for sizing only, e.g. "h-40". */
  className?: string
}

/** A bordered box with one muted sentence. */
export function EmptyState({ children, action, align = 'start', className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex flex-col gap-3 rounded-lg border border-zinc-800 px-4 py-6 text-sm text-zinc-400',
        align === 'center' ? 'items-center justify-center text-center' : 'items-start',
        className
      )}
    >
      <p>{children}</p>
      {action}
    </div>
  )
}

/** A small neutral label, e.g. "Inactive". */
export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400',
        className
      )}
      {...props}
    />
  )
}

/** A keyboard key in a shortcut hint, e.g. <Kbd>D</Kbd>. */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cx(
        'inline-flex min-w-5 items-center justify-center rounded border border-zinc-700 bg-zinc-900 px-1 font-sans text-[11px] leading-4 text-zinc-300',
        className
      )}
      {...props}
    />
  )
}

export interface InlineConfirmProps {
  /** The question, e.g. "Deactivate?" or "End Round 2 early and start a new one?" */
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  /** Shows a spinner on the confirm button and disables both. */
  pending?: boolean
  /** "danger" styles the confirm button as destructive. Default "danger". */
  tone?: 'danger' | 'default'
  className?: string
}

/**
 * Replaces a destructive button with "Question? Yes / Cancel". Cancel gets
 * focus when it appears, so Enter never confirms by accident, and Escape
 * cancels.
 */
export function InlineConfirm({
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  pending = false,
  tone = 'danger',
  className,
}: InlineConfirmProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !pending) {
      event.stopPropagation()
      onCancel()
    }
  }
  return (
    <div
      role="group"
      onKeyDown={handleKeyDown}
      className={cx('inline-flex flex-wrap items-center gap-2 text-sm', className)}
    >
      <span className="text-zinc-300">{message}</span>
      <Button
        size="sm"
        variant={tone === 'danger' ? 'danger' : 'primary'}
        loading={pending}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel} autoFocus>
        {cancelLabel}
      </Button>
    </div>
  )
}

// Forms

const controlClasses =
  'h-9 w-full rounded-md border border-zinc-600 bg-zinc-900 px-3 text-sm text-zinc-100 ' +
  'transition-colors duration-150 placeholder:text-zinc-400 hover:border-zinc-500 focus-visible:border-zinc-400 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-rose-700'

export interface FieldProps {
  label: ReactNode
  /** The id of the control inside, so the label is connected. */
  htmlFor: string
  /** Muted helper text under the control. */
  hint?: ReactNode
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean
  children: ReactNode
  className?: string
}

/** A label above a control, with optional hint text. */
export function Field({ label, htmlFor, hint, hideLabel, children, className }: FieldProps) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className={cx('text-xs font-medium text-zinc-400', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-zinc-400">{hint}</p> : null}
    </div>
  )
}

/** A text input with the shared control style. Always give it a label (Field) or aria-label. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type, ...props }, ref) {
    return (
      <input ref={ref} type={type ?? 'text'} className={cx(controlClasses, className)} {...props} />
    )
  }
)

/** A native select with the shared control style. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cx(controlClasses, className)} {...props} />
  }
)

export interface RankSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  value: string
  /** "full" shows "SPC - Specialist"; "code" shows "SPC" for narrow cells. Default "full". */
  labels?: 'full' | 'code'
}

/**
 * A select over lib/ranks.ts with Enlisted and Officers groups. A stored rank
 * that is not in the list stays selectable so editing never changes it silently.
 */
export const RankSelect = forwardRef<HTMLSelectElement, RankSelectProps>(function RankSelect(
  { value, labels = 'full', ...props },
  ref
) {
  return (
    <Select ref={ref} value={value} {...props}>
      {value && !isKnownRank(value) ? <option value={value}>{value}</option> : null}
      {RANK_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.ranks.map((rank) => (
            <option key={rank.code} value={rank.code}>
              {labels === 'full' ? `${rank.code} - ${rank.title}` : rank.code}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  )
})
