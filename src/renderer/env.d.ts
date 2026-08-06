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

interface HabitGridApi {
  listHabits: () => Promise<Habit[]>
  addHabit: (name: string) => Promise<Habit>
  deleteHabit: (id: number) => Promise<void>
  reorderHabits: (orderedIds: number[]) => Promise<void>
  getCompletions: (startDate: string, endDate: string) => Promise<CompletionsMap>
  toggleCompletion: (habitId: number, date: string) => Promise<boolean>
  resize: (height: number, width: number) => Promise<void>
}

interface Window {
  api: HabitGridApi
}
