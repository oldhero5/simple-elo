/**
 * Joins class names, skipping falsy values.
 *
 * There is no Tailwind conflict resolution: when two classes set the same
 * property, the one generated later in the stylesheet wins regardless of
 * order here. Prefer component props (variant, size, align) over overriding
 * a primitive's built-in classes through `className`.
 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
