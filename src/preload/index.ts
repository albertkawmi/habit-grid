import { contextBridge, ipcRenderer } from 'electron'

export interface Habit {
  id: number
  name: string
  created_at: string
  position: number
}

export type CompletionsMap = Record<number, string[]>

const api = {
  listHabits: (): Promise<Habit[]> => ipcRenderer.invoke('habits:list'),
  addHabit: (name: string): Promise<Habit> => ipcRenderer.invoke('habits:add', name),
  deleteHabit: (id: number): Promise<void> => ipcRenderer.invoke('habits:delete', id),
  reorderHabits: (orderedIds: number[]): Promise<void> =>
    ipcRenderer.invoke('habits:reorder', orderedIds),
  getCompletions: (startDate: string, endDate: string): Promise<CompletionsMap> =>
    ipcRenderer.invoke('completions:getRange', startDate, endDate),
  toggleCompletion: (habitId: number, date: string): Promise<boolean> =>
    ipcRenderer.invoke('completions:toggle', habitId, date),
  resize: (height: number, width: number): Promise<void> =>
    ipcRenderer.invoke('app:resize', height, width)
}

contextBridge.exposeInMainWorld('api', api)
