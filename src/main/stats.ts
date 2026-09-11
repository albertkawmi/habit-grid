import { addDays, daysBetween } from '../shared/dates'
import { type CompletionsMap, getAllCompletions, listHabits, todayLocal } from './db'

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

/** Consecutive done days; pass days are skipped so they neither count nor break a streak. */
function bestStreak(
  done: Set<string>,
  pass: Set<string>,
  firstDate: string,
  today: string
): number {
  let best = 0
  let run = 0
  const total = daysBetween(firstDate, today)
  for (let i = 0; i <= total; i++) {
    const key = addDays(firstDate, i)
    if (done.has(key)) {
      run += 1
      if (run > best) best = run
    } else if (pass.has(key)) {
      continue
    } else {
      run = 0
    }
  }
  return best
}

function currentStreak(done: Set<string>, pass: Set<string>, today: string): number {
  let key = today
  while (pass.has(key)) {
    key = addDays(key, -1)
  }
  if (!done.has(key)) return 0

  let streak = 0
  while (true) {
    if (done.has(key)) {
      streak += 1
    } else if (!pass.has(key)) {
      break
    }
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

function doneAndPass(entries: CompletionsMap[number]): {
  done: Set<string>
  pass: Set<string>
  firstDone: string | null
} {
  const done = new Set<string>()
  const pass = new Set<string>()
  for (const [date, status] of Object.entries(entries)) {
    if (status === 'pass') pass.add(date)
    else done.add(date)
  }

  let firstDone: string | null = null
  for (const date of done) {
    if (firstDone === null || date < firstDone) firstDone = date
  }
  return { done, pass, firstDone }
}

function trackedDaysInWindow(firstDate: string, today: string, pass: Set<string>): number {
  const span = daysBetween(firstDate, today) + 1
  let passDays = 0
  for (let i = 0; i < span; i++) {
    if (pass.has(addDays(firstDate, i))) passDays += 1
  }
  return span - passDays
}

export function getStats(): StatsPayload {
  const today = todayLocal()
  const habits = listHabits()
  const completions = getAllCompletions()

  let totalCompletions = 0
  let pooledCompleted = 0
  let pooledTracked = 0

  const habitStats: HabitStats[] = habits.map((habit) => {
    const { done, pass, firstDone } = doneAndPass(completions[habit.id] ?? {})
    totalCompletions += done.size

    if (firstDone === null) {
      return emptyHabitStats(habit.id, habit.name)
    }

    const trackedDays = trackedDaysInWindow(firstDone, today, pass)
    const completedDays = done.size
    const compliance = trackedDays > 0 ? completedDays / trackedDays : 0

    pooledCompleted += completedDays
    pooledTracked += trackedDays

    return {
      habitId: habit.id,
      name: habit.name,
      firstDate: firstDone,
      trackedDays,
      completedDays,
      compliance,
      bestStreak: bestStreak(done, pass, firstDone, today),
      currentStreak: currentStreak(done, pass, today),
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
