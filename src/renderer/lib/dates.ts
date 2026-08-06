const DAY_MS = 24 * 60 * 60 * 1000

/** Local calendar date as YYYY-MM-DD. Keys sort chronologically as strings. */
export function formatDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayKey(): string {
  return formatDateKey(new Date())
}

export function addDays(key: string, days: number): string {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + days)
  return formatDateKey(date)
}

export function daysBetween(start: string, end: string): number {
  return Math.round((parseDateKey(end).getTime() - parseDateKey(start).getTime()) / DAY_MS)
}

export function isMonday(key: string): boolean {
  return parseDateKey(key).getDay() === 1
}

/** Snaps back to the Monday on or before the given date. */
export function startOfWeek(key: string): string {
  const day = parseDateKey(key).getDay()
  const offset = day === 0 ? 6 : day - 1
  return addDays(key, -offset)
}

export function formatWeekLabel(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatFullDate(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

export function formatShortDate(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
}

/** Inclusive list of date keys from start to end. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = []
  const total = daysBetween(start, end)
  for (let i = 0; i <= total; i++) {
    out.push(addDays(start, i))
  }
  return out
}
