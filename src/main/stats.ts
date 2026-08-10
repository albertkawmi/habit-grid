import { getAllCompletions, listHabits, todayLocal } from './db'

export interface HabitStats {
  habitId: number
  name: string
  firstDate: string | null
  trackedDays: number
  completedDays: number
  compliance: number
  bestStreak: number
  currentStreak: number
  weeklyAverage: number
}

export interface AggregateStats {
  totalCompletions: number
  overallCompliance: number
}

export interface StatsPayload {
  habits: HabitStats[]
  aggregate: AggregateStats
  asOf: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(key: string, days: number): string {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + days)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function daysBetween(start: string, end: string): number {
  return Math.round((parseDateKey(end).getTime() - parseDateKey(start).getTime()) / DAY_MS)
}

function bestStreak(dates: Set<string>, firstDate: string, today: string): number {
  let best = 0
  let run = 0
  const total = daysBetween(firstDate, today)
  for (let i = 0; i <= total; i++) {
    const key = addDays(firstDate, i)
    if (dates.has(key)) {
      run += 1
      if (run > best) best = run
    } else {
      run = 0
    }
  }
  return best
}

function currentStreak(dates: Set<string>, today: string): number {
  if (!dates.has(today)) return 0
  let streak = 0
  let key = today
  while (dates.has(key)) {
    streak += 1
    key = addDays(key, -1)
  }
  return streak
}

function emptyHabitStats(habitId: number, name: string): HabitStats {
  return {
    habitId,
    name,
    firstDate: null,
    trackedDays: 0,
    completedDays: 0,
    compliance: 0,
    bestStreak: 0,
    currentStreak: 0,
    weeklyAverage: 0
  }
}

export function getStats(): StatsPayload {
  const today = todayLocal()
  const habits = listHabits()
  const completions = getAllCompletions()

  let totalCompletions = 0
  let pooledCompleted = 0
  let pooledTracked = 0

  const habitStats: HabitStats[] = habits.map((habit) => {
    const dates = completions[habit.id] ?? []
    totalCompletions += dates.length

    if (dates.length === 0) {
      return emptyHabitStats(habit.id, habit.name)
    }

    const dateSet = new Set(dates)
    const firstDate = dates[0]
    const trackedDays = daysBetween(firstDate, today) + 1
    const completedDays = dates.length
    const compliance = trackedDays > 0 ? completedDays / trackedDays : 0

    pooledCompleted += completedDays
    pooledTracked += trackedDays

    return {
      habitId: habit.id,
      name: habit.name,
      firstDate,
      trackedDays,
      completedDays,
      compliance,
      bestStreak: bestStreak(dateSet, firstDate, today),
      currentStreak: currentStreak(dateSet, today),
      weeklyAverage: trackedDays > 0 ? completedDays / (trackedDays / 7) : 0
    }
  })

  return {
    habits: habitStats,
    aggregate: {
      totalCompletions,
      overallCompliance: pooledTracked > 0 ? pooledCompleted / pooledTracked : 0
    },
    asOf: today
  }
}
