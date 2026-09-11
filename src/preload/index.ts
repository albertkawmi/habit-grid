import { contextBridge, ipcRenderer } from 'electron'

export interface Habit {
  id: number
  name: string
  created_at: string
  position: number
}

export type CellStatus = 'done' | 'pass'

export type CompletionsMap = Record<number, Record<string, CellStatus>>

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

const api = {
  listHabits: (): Promise<Habit[]> => ipcRenderer.invoke('habits:list'),
  addHabit: (name: string): Promise<Habit> => ipcRenderer.invoke('habits:add', name),
  deleteHabit: (id: number): Promise<void> => ipcRenderer.invoke('habits:delete', id),
  reorderHabits: (orderedIds: number[]): Promise<void> =>
    ipcRenderer.invoke('habits:reorder', orderedIds),
  getCompletions: (startDate: string, endDate: string): Promise<CompletionsMap> =>
    ipcRenderer.invoke('completions:getRange', startDate, endDate),
  toggleCompletion: (habitId: number, date: string): Promise<CellStatus | null> =>
    ipcRenderer.invoke('completions:toggle', habitId, date),
  getStats: (): Promise<StatsPayload> => ipcRenderer.invoke('stats:get'),
  resize: (height: number): Promise<void> => ipcRenderer.invoke('app:resize', height)
}

contextBridge.exposeInMainWorld('api', api)
