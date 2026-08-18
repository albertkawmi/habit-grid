/// <reference types="vite/client" />

interface Habit {
  id: number
  name: string
  created_at: string
  position: number
}

interface CompletionsMap {
  [habitId: number]: string[]
}

interface HabitStats {
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

interface AggregateStats {
  totalCompletions: number
  overallCompliance: number
}

interface StatsPayload {
  habits: HabitStats[]
  aggregate: AggregateStats
  asOf: string
}

interface HabitGridApi {
  listHabits: () => Promise<Habit[]>
  addHabit: (name: string) => Promise<Habit>
  deleteHabit: (id: number) => Promise<void>
  reorderHabits: (orderedIds: number[]) => Promise<void>
  getCompletions: (startDate: string, endDate: string) => Promise<CompletionsMap>
  toggleCompletion: (habitId: number, date: string) => Promise<boolean>
  getStats: () => Promise<StatsPayload>
  resize: (height: number) => Promise<void>
}

interface Window {
  api: HabitGridApi
}
