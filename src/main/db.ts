import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

export interface Habit {
  id: number
  name: string
  created_at: string
  position: number
}

export type CompletionsMap = Record<number, string[]>

let db: Database.Database

export function initDb(): void {
  const dbPath = join(app.getPath('userData'), 'habit-grid.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS completions (
      habit_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      PRIMARY KEY (habit_id, date),
      FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
    );
  `)
}

export function listHabits(): Habit[] {
  return db
    .prepare('SELECT id, name, created_at, position FROM habits ORDER BY position ASC, id ASC')
    .all() as Habit[]
}

export function addHabit(name: string): Habit {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Habit name is required')
  }

  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM habits').get() as {
    max: number
  }
  const created_at = new Date().toISOString()
  const position = maxPos.max + 1

  const result = db
    .prepare('INSERT INTO habits (name, created_at, position) VALUES (?, ?, ?)')
    .run(trimmed, created_at, position)

  return {
    id: Number(result.lastInsertRowid),
    name: trimmed,
    created_at,
    position
  }
}

export function deleteHabit(id: number): void {
  db.prepare('DELETE FROM habits WHERE id = ?').run(id)
}

/** Rewrite positions to match the given id order (0..n-1). */
export function reorderHabits(orderedIds: number[]): void {
  const update = db.prepare('UPDATE habits SET position = ? WHERE id = ?')
  const apply = db.transaction((ids: number[]) => {
    ids.forEach((id, position) => {
      update.run(position, id)
    })
  })
  apply(orderedIds)
}

export function getCompletions(startDate: string, endDate: string): CompletionsMap {
  const rows = db
    .prepare(
      `SELECT habit_id, date FROM completions
       WHERE date >= ? AND date <= ?
       ORDER BY date ASC`
    )
    .all(startDate, endDate) as Array<{ habit_id: number; date: string }>

  const map: CompletionsMap = {}
  for (const row of rows) {
    if (!map[row.habit_id]) {
      map[row.habit_id] = []
    }
    map[row.habit_id].push(row.date)
  }
  return map
}

function todayLocal(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function toggleCompletion(habitId: number, date: string): boolean {
  if (date > todayLocal()) {
    throw new Error('Cannot complete habits on a future date')
  }

  const existing = db
    .prepare('SELECT 1 FROM completions WHERE habit_id = ? AND date = ?')
    .get(habitId, date)

  if (existing) {
    db.prepare('DELETE FROM completions WHERE habit_id = ? AND date = ?').run(habitId, date)
    return false
  }

  db.prepare('INSERT INTO completions (habit_id, date) VALUES (?, ?)').run(habitId, date)
  return true
}
