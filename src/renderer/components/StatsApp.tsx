import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatWeeklyAverage(value: number): string {
  return `${value.toFixed(1)} / week`
}

function complianceBarClass(compliance: number): string {
  if (compliance >= 0.66) return 'bg-done'
  if (compliance >= 0.33) return 'bg-chart-4'
  return 'bg-danger'
}

function HabitRow({ habit }: { habit: HabitStats }): React.JSX.Element {
  if (habit.firstDate === null) {
    return (
      <div className="flex items-baseline justify-between gap-3 border-b border-line py-2.5">
        <p className="min-w-0 truncate text-[12.5px] font-medium text-ink">{habit.name}</p>
        <p className="shrink-0 text-[11px] text-ink-faint">No data yet</p>
      </div>
    )
  }

  const barWidth = `${Math.min(100, Math.max(0, habit.compliance * 100))}%`

  return (
    <div className="border-b border-line py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[12.5px] font-medium text-ink">{habit.name}</p>
        <p className="shrink-0 text-[13px] font-semibold tabular-nums text-done">
          {formatPercent(habit.compliance)}
        </p>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-cell">
          <div
            className={cn('h-full rounded-sm', complianceBarClass(habit.compliance))}
            style={{ width: barWidth }}
          />
        </div>
        <p className="shrink-0 text-[10.5px] tabular-nums text-ink-faint">
          {habit.completedDays} / {habit.trackedDays} days
        </p>
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[11px] text-ink-muted">
        <p>
          Streak {habit.currentStreak}
          <span className="text-ink-faint"> · </span>
          Best {habit.bestStreak}
        </p>
        <p className="tabular-nums">{formatWeeklyAverage(habit.weeklyAverage)}</p>
      </div>
    </div>
  )
}

export default function StatsApp(): React.JSX.Element {
  const [stats, setStats] = useState<StatsPayload | null>(null)

  const load = useCallback(async () => {
    setStats(await window.api.getStats())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onFocus = (): void => {
      void load()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface text-ink">
      <header className="sticky top-0 z-10 shrink-0 border-b border-line bg-surface px-4 pb-3 pt-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[22px] font-semibold leading-none tabular-nums tracking-tight">
              {stats ? stats.aggregate.totalCompletions.toLocaleString() : '—'}
            </p>
            <p className="mt-1 text-[11px] text-ink-muted">completed</p>
          </div>
          <div>
            <p
              className={cn(
                'text-[22px] font-semibold leading-none tabular-nums tracking-tight',
                stats ? 'text-done' : undefined
              )}
            >
              {stats ? formatPercent(stats.aggregate.overallCompliance) : '—'}
            </p>
            <p className="mt-1 text-[11px] text-ink-muted">overall compliance</p>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <h2 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Habits
        </h2>

        {!stats ? null : stats.habits.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-0.5 py-16">
            <p className="text-[12px] font-medium text-ink">No habits yet</p>
            <p className="text-[11px] text-ink-faint">Add habits in the tray popup to see stats.</p>
          </div>
        ) : (
          <div>
            {stats.habits.map((habit) => (
              <HabitRow key={habit.habitId} habit={habit} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
