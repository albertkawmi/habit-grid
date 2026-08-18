import { addDays, daysBetween, startOfWeek, todayKey } from './dates'

export const CELL = 12
export const GAP = 3
export const COL = CELL + GAP
export const AXIS_H = 16
export const NAME_W = 116
export const MAIN_PADDING_X = 24 // matches main `px-3` (12 + 12)

/** Monday of the previous week — left edge of the default (minimum) viewport. */
export function visibleStart(today: string = todayKey()): string {
  return addDays(startOfWeek(today), -7)
}

/** Seven days after today — right edge of the grid. */
export function horizonEnd(today: string = todayKey()): string {
  return addDays(today, 7)
}

/** Previous Monday through today+7 (~1.5 weeks past + 1 week future). */
export function visibleDayCount(today: string = todayKey()): number {
  return daysBetween(visibleStart(today), horizonEnd(today)) + 1
}

/** Window width that fits habit names + `dayCount` day cells. */
export function gridContentWidth(dayCount: number): number {
  return NAME_W + MAIN_PADDING_X + dayCount * COL - GAP
}

/**
 * Minimum window width: habit names plus the default visible range
 * (previous Monday through today+7).
 */
export function minPopupWidth(today: string = todayKey()): number {
  return gridContentWidth(visibleDayCount(today))
}

/**
 * Maximum window width: names plus one week before the earliest habit entry
 * through the future horizon. Never narrower than the minimum viewport.
 */
export function maxPopupWidth(
  earliestEntry: string | null,
  today: string = todayKey()
): number {
  const min = minPopupWidth(today)
  if (!earliestEntry) return min
  const left = addDays(earliestEntry, -7)
  const days = daysBetween(left, horizonEnd(today)) + 1
  if (days <= 0) return min
  return Math.max(min, gridContentWidth(days))
}
