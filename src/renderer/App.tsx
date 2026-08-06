import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { HabitGrid, gridHeight, popupContentWidth } from '@/components/HabitGrid'
import { Input } from '@/components/ui/input'
import { formatShortDate, todayKey } from '@/lib/dates'

const HEADER_H = 36
const MAIN_PADDING_Y = 20

interface AddHabitFormProps {
  onAdd: (name: string) => Promise<void>
}

/** Owns the controlled input so keystrokes do not re-render the habit grid. */
function AddHabitForm({ onAdd }: AddHabitFormProps): React.JSX.Element {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    await onAdd(trimmed)
    setName('')
    inputRef.current?.focus()
  }

  return (
    <form className="ml-auto flex min-w-0 items-center" onSubmit={(e) => void handleSubmit(e)}>
      <div className="relative w-[160px]">
        <Plus className="pointer-events-none absolute left-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-ink-faint" />
        <Input
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Add a habit…"
          maxLength={40}
          aria-label="New habit name"
          className="h-6 pl-5 text-[10.5px]"
        />
      </div>
    </form>
  )
}

export default function App(): React.JSX.Element {
  const [habits, setHabits] = useState<Habit[]>([])
  const [ready, setReady] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const loadHabits = useCallback(async () => {
    setHabits(await window.api.listHabits())
    setReady(true)
  }, [])

  useEffect(() => {
    void loadHabits()
  }, [loadHabits])

  // Reopening the popup should show fresh data centred on the current day.
  useEffect(() => {
    const onFocus = (): void => {
      void loadHabits()
      setRefreshKey((key) => key + 1)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadHabits])

  useEffect(() => {
    if (!ready) return
    void window.api.resize(
      HEADER_H + MAIN_PADDING_Y + gridHeight(habits.length),
      popupContentWidth()
    )
  }, [habits.length, ready])

  const addHabit = useCallback(
    async (name: string): Promise<void> => {
      await window.api.addHabit(name)
      await loadHabits()
    },
    [loadHabits]
  )

  const deleteHabit = useCallback(
    async (id: number): Promise<void> => {
      await window.api.deleteHabit(id)
      await loadHabits()
    },
    [loadHabits]
  )

  const reorderHabits = useCallback(async (orderedIds: number[]): Promise<void> => {
    setHabits((prev) => {
      const byId = new Map(prev.map((habit) => [habit.id, habit]))
      return orderedIds.flatMap((id, position) => {
        const habit = byId.get(id)
        return habit ? [{ ...habit, position }] : []
      })
    })
    await window.api.reorderHabits(orderedIds)
  }, [])

  const handleDeleteHabit = useCallback(
    (id: number): void => {
      void deleteHabit(id)
    },
    [deleteHabit]
  )

  const handleReorderHabits = useCallback(
    (ids: number[]): void => {
      void reorderHabits(ids)
    },
    [reorderHabits]
  )

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <header
        className="flex shrink-0 items-center gap-2 border-b border-line px-3"
        style={{ height: HEADER_H }}
      >
        <div className="flex items-baseline gap-2">
          <h1 className="text-[12px] font-semibold tracking-tight text-ink">Habit Grid</h1>
          <span className="text-[10.5px] text-ink-faint">{formatShortDate(todayKey())}</span>
        </div>

        <AddHabitForm onAdd={addHabit} />
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2.5">
        {!ready ? null : habits.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-0.5">
            <p className="text-[11.5px] font-medium text-ink">No habits yet</p>
            <p className="text-[10.5px] text-ink-faint">
              Add your first habit above to start tracking.
            </p>
          </div>
        ) : (
          <HabitGrid
            habits={habits}
            refreshKey={refreshKey}
            onDeleteHabit={handleDeleteHabit}
            onReorderHabits={handleReorderHabits}
          />
        )}
      </main>
    </div>
  )
}
