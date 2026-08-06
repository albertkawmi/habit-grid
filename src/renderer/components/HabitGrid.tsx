import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  addDays,
  dateRange,
  daysBetween,
  formatFullDate,
  formatWeekLabel,
  isMonday,
  startOfWeek,
  todayKey
} from '@/lib/dates'
import { cn } from '@/lib/utils'

const CELL = 12
const GAP = 3
const COL = CELL + GAP
const AXIS_H = 16
const NAME_W = 116
const MAIN_PADDING_X = 24 // matches main `px-3` (12 + 12)
const INITIAL_WEEKS = 26
const EXTEND_WEEKS = 26
/** Previous week + current week + following week. */
const VISIBLE_WEEKS = 3
const VISIBLE_DAYS = VISIBLE_WEEKS * 7

/** Monday of the previous week — left edge of the default viewport. */
export function visibleStart(today: string = todayKey()): string {
  return addDays(startOfWeek(today), -7)
}

/** Sunday of next week — right edge of the default viewport. */
export function horizonEnd(today: string = todayKey()): string {
  return addDays(startOfWeek(today), 13)
}

/** Always 21 days: previous + current + following week. */
export function visibleDayCount(): number {
  return VISIBLE_DAYS
}

/**
 * Window width that fits habit names + three full weeks of day cells.
 * NAME_W(116) + main px-3(24) + 21*(12+3)-3 = 452
 */
export function popupContentWidth(): number {
  return NAME_W + MAIN_PADDING_X + VISIBLE_DAYS * COL - GAP
}

/** Height the grid needs so the window can be sized to fit its rows exactly. */
export function gridHeight(habitCount: number): number {
  if (habitCount === 0) return 58
  return AXIS_H + GAP + habitCount * CELL + (habitCount - 1) * GAP + 4
}

interface HoverTarget {
  habit: Habit
  date: string
  left: number
  top: number
}

interface HabitGridProps {
  habits: Habit[]
  /** Bumped by the shell to force a reload and re-align the 3-week view. */
  refreshKey: number
  onDeleteHabit: (id: number) => void
  onReorderHabits: (orderedIds: number[]) => void
}

interface SortableHabitNameProps {
  habit: Habit
  highlighted: boolean
  onDelete: () => void
  onHover: () => void
}

function SortableHabitName({
  habit,
  highlighted,
  onDelete,
  onHover
}: SortableHabitNameProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: habit.id
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group/name relative flex items-center overflow-visible rounded pl-1 pr-0.5',
        isDragging && 'z-20 opacity-80'
      )}
      style={{
        height: CELL,
        transform: CSS.Transform.toString(transform),
        transition
      }}
      onMouseEnter={onHover}
    >
      <button
        type="button"
        aria-label={`Reorder ${habit.name}`}
        className={cn(
          'absolute left-0 top-1/2 z-10 grid h-3 w-2.5 -translate-y-1/2 place-items-center rounded-sm',
          'cursor-grab text-ink-faint opacity-0 transition-opacity duration-100',
          'group-hover/name:opacity-100 hover:text-ink-muted',
          'active:cursor-grabbing focus-visible:opacity-100',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
          isDragging && 'opacity-100 cursor-grabbing'
        )}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-2.5 w-2.5" strokeWidth={2.25} />
      </button>
      {/*
        Absolute + taller line-height lets descenders paint into the row gap
        without changing pitch. overflow-x: clip (not hidden) keeps long names
        from bleeding into the grid while leaving the y-axis visible.
        Left inset shifts on hover so the grip can sit just before the text.
      */}
      <span
        className={cn(
          'pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 whitespace-nowrap',
          'left-1 overflow-x-clip text-[11px] leading-[14px]',
          'group-hover/name:left-3',
          '[mask-image:linear-gradient(to_right,#000_82%,transparent)]',
          'transition-[color,left] duration-100',
          highlighted ? 'text-ink' : 'text-ink-muted',
          isDragging && 'left-3'
        )}
        title={habit.name}
      >
        {habit.name}
      </span>
      <button
        type="button"
        aria-label={`Delete ${habit.name}`}
        onClick={onDelete}
        className={cn(
          'relative z-10 ml-auto grid h-3.5 w-3.5 shrink-0 place-items-center rounded opacity-0',
          'text-ink-faint transition-opacity duration-100',
          'group-hover/name:opacity-100 hover:bg-danger/15 hover:text-danger',
          'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger/60'
        )}
      >
        <X className="h-2.5 w-2.5" strokeWidth={2.5} />
      </button>
    </div>
  )
}

export function HabitGrid({
  habits,
  refreshKey,
  onDeleteHabit,
  onReorderHabits
}: HabitGridProps): React.JSX.Element {
  const today = todayKey()
  const [weeksBack, setWeeksBack] = useState(INITIAL_WEEKS)
  const [completions, setCompletions] = useState<CompletionsMap>({})
  const [hover, setHover] = useState<HoverTarget | null>(null)
  /** True when older days sit off-screen to the left of the viewport. */
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [activeId, setActiveId] = useState<number | null>(null)

  const scrollerRef = useRef<HTMLDivElement>(null)
  // Distance from the right edge, preserved while prepending older columns.
  const rightAnchor = useRef<number | null>(null)

  const habitIds = useMemo(() => habits.map((habit) => habit.id), [habits])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const start = useMemo(
    () => startOfWeek(addDays(today, -weeksBack * 7)),
    [today, weeksBack]
  )
  // Through Sunday of next week (previous + current + following week).
  const end = useMemo(() => horizonEnd(today), [today])
  const dates = useMemo(() => dateRange(start, end), [start, end])
  const gridWidth = dates.length * COL - GAP
  const homeScroll = useMemo(
    () => Math.max(0, daysBetween(start, visibleStart(today)) * COL),
    [start, today]
  )

  const completedByHabit = useMemo(() => {
    const map = new Map<number, Set<string>>()
    for (const [id, list] of Object.entries(completions)) {
      map.set(Number(id), new Set(list))
    }
    return map
  }, [completions])

  useEffect(() => {
    let cancelled = false
    void window.api.getCompletions(start, end).then((data) => {
      if (!cancelled) setCompletions(data)
    })
    return () => {
      cancelled = true
    }
  }, [start, end, habits, refreshKey])

  // Snap so previous / current / next week fill the viewport with no scrolling needed.
  const alignVisibleRange = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollLeft = homeScroll
    setCanScrollLeft(el.scrollLeft > 2)
  }, [homeScroll])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewportWidth(el.clientWidth))
    observer.observe(el)
    setViewportWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (viewportWidth === 0) return
    alignVisibleRange()
    // Only re-align on an explicit refresh, never when older weeks load in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, viewportWidth])

  // Map vertical wheel / trackpad to horizontal time scroll. Native overflow is
  // x-only and the scrollbar is hidden, so without this most scroll gestures do nothing.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    const onWheel = (event: WheelEvent): void => {
      const absX = Math.abs(event.deltaX)
      const absY = Math.abs(event.deltaY)
      // True horizontal gestures already scroll overflow-x; don't double-apply.
      if (absX > absY) return
      if (absY === 0) return

      const maxScroll = el.scrollWidth - el.clientWidth
      const next = Math.min(maxScroll, Math.max(0, el.scrollLeft + event.deltaY))
      if (next === el.scrollLeft) return

      event.preventDefault()
      el.scrollLeft = next
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Keep the viewport visually still while older columns are prepended.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || rightAnchor.current === null) return
    el.scrollLeft = el.scrollWidth - rightAnchor.current
    rightAnchor.current = null
  }, [dates])

  const handleScroll = (): void => {
    const el = scrollerRef.current
    if (!el) return

    setCanScrollLeft(el.scrollLeft > 2)
    setHover(null)

    if (el.scrollLeft < COL * 7 && rightAnchor.current === null) {
      rightAnchor.current = el.scrollWidth - el.scrollLeft
      setWeeksBack((weeks) => weeks + EXTEND_WEEKS)
    }
  }

  const toggle = async (habitId: number, date: string): Promise<void> => {
    if (date > today) return
    const done = await window.api.toggleCompletion(habitId, date)
    setCompletions((prev) => {
      const updated = new Set(prev[habitId] ?? [])
      if (done) updated.add(date)
      else updated.delete(date)
      return { ...prev, [habitId]: Array.from(updated) }
    })
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = habitIds.indexOf(Number(active.id))
    const newIndex = habitIds.indexOf(Number(over.id))
    if (oldIndex < 0 || newIndex < 0) return

    onReorderHabits(arrayMove(habitIds, oldIndex, newIndex))
  }

  const hoveredDone =
    hover !== null && (completedByHabit.get(hover.habit.id)?.has(hover.date) ?? false)

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 overflow-visible"
      onMouseLeave={() => setHover(null)}
    >
      {/* Habit names — fixed beside the scrolling day grid, sharing its row metrics.
          Rows stay CELL tall so pitch matches the grid; overflow is visible so
          descenders can use the gap instead of being clipped by truncate. */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => setActiveId(Number(active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={habitIds} strategy={verticalListSortingStrategy}>
          <div
            className="flex shrink-0 flex-col justify-start overflow-visible pr-2"
            style={{ width: NAME_W, gap: GAP }}
          >
            <div style={{ height: AXIS_H }} />
            {habits.map((habit) => (
              <SortableHabitName
                key={habit.id}
                habit={habit}
                highlighted={hover?.habit.id === habit.id}
                onDelete={() => onDeleteHabit(habit.id)}
                onHover={() => setHover(null)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="relative min-w-0 flex-1">
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="grid-scroll h-full overflow-x-auto overflow-y-hidden"
        >
          <div className="flex flex-col" style={{ width: gridWidth, gap: GAP }}>
            {/* Week axis: only Mondays are labelled. */}
            <div className="relative" style={{ height: AXIS_H, width: gridWidth }}>
              {dates.map((date, index) =>
                isMonday(date) ? (
                  <span
                    key={date}
                    className="absolute top-0 whitespace-nowrap text-[9.5px] font-medium leading-none tracking-wide text-ink-faint"
                    style={{ left: index * COL }}
                  >
                    {formatWeekLabel(date)}
                  </span>
                ) : null
              )}
            </div>

            {habits.map((habit) => {
              const done = completedByHabit.get(habit.id)
              return (
                <div
                  key={habit.id}
                  className={cn(
                    'flex transition-opacity duration-100',
                    activeId === habit.id && 'opacity-40'
                  )}
                  style={{ height: CELL, gap: GAP }}
                >
                  {dates.map((date) => {
                    const future = date > today
                    const isDone = done?.has(date) ?? false
                    return (
                      <button
                        key={date}
                        type="button"
                        tabIndex={-1}
                        disabled={future}
                        aria-label={`${habit.name} — ${formatFullDate(date)}`}
                        aria-pressed={isDone}
                        onClick={() => void toggle(habit.id, date)}
                        onMouseEnter={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect()
                          setHover({ habit, date, left: rect.left, top: rect.top })
                        }}
                        className={cn(
                          'shrink-0 rounded-[3px] transition-[background-color,transform] duration-75',
                          future
                            ? 'cursor-default bg-cell/40'
                            : isDone
                              ? 'bg-done hover:bg-done-hover hover:scale-[1.18]'
                              : 'bg-cell hover:bg-cell-hover hover:scale-[1.18]',
                          date === today && 'ring-2 ring-accent'
                        )}
                        style={{
                          width: CELL,
                          height: CELL,
                          outline: '1px solid var(--cell-ring)',
                          outlineOffset: -1
                        }}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        {/* Hints that older history sits off-screen to the left. */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-6 transition-opacity duration-150',
            'bg-gradient-to-r from-surface to-transparent',
            canScrollLeft ? 'opacity-100' : 'opacity-0'
          )}
        />
      </div>

      {/* A single tooltip follows the hovered cell instead of one per square. */}
      <Tooltip open={hover !== null} disableHoverableContent>
        <TooltipTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed block"
            style={{
              left: hover?.left ?? 0,
              top: hover?.top ?? 0,
              width: CELL,
              height: CELL
            }}
          />
        </TooltipTrigger>
        <TooltipContent
          side="right"
          align="center"
          onPointerEnter={() => setHover(null)}
        >
          {hover ? (
            <>
              <div className="font-semibold">{hover.habit.name}</div>
              <div className="text-white/70">{formatFullDate(hover.date)}</div>
              <div className="mt-0.5 flex items-center gap-1 text-white/70">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    hover.date > today
                      ? 'bg-white/30'
                      : hoveredDone
                        ? 'bg-done'
                        : 'bg-white/40'
                  )}
                />
                {hover.date > today ? 'Upcoming' : hoveredDone ? 'Done' : 'Not done'}
              </div>
            </>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
