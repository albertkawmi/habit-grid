import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import { formatDateKey } from '../shared/dates'

export interface Habit {
  id: number
  name: string
  created_at: string
  position: number
}

export type CompletionsMap = Record<number, string[]>

const require = createRequire(__filename)

let db: Database
let dbPath: string

function persist(): void {
  const data = db.export()
  writeFileSync(dbPath, Buffer.from(data))
}

function queryAll<T>(sql: string, params: SqlValue[] = []): T[] {
  const stmt = db.prepare(sql)
  try {
    stmt.bind(params)
    const rows: T[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T)
    }
    return rows
  } finally {
    stmt.free()
  }
}

function queryOne<T>(sql: string, params: SqlValue[] = []): T | undefined {
  return queryAll<T>(sql, params)[0]
}

function run(sql: string, params: SqlValue[] = []): void {
  db.run(sql, params)
}

function sqlWasmPath(file: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, file)
  }
  return join(dirname(require.resolve('sql.js')), file)
}

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file) => sqlWasmPath(file)
  })

  dbPath = join(app.getPath('userData'), 'habit-grid.db')
  if (existsSync(dbPath)) {
    db = new SQL.Database(readFileSync(dbPath))
  } else {
    db = new SQL.Database()
  }

  // In-memory SQL.js; WAL does not apply. Persist via export() after writes.
  run('PRAGMA foreign_keys = ON')

  run(`
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

  persist()
}

export function listHabits(): Habit[] {
  return queryAll<Habit>(
    'SELECT id, name, created_at, position FROM habits ORDER BY position ASC, id ASC'
  )
}

export function addHabit(name: string): Habit {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Habit name is required')
  }

  const maxPos = queryOne<{ max: number }>('SELECT COALESCE(MAX(position), -1) AS max FROM habits')
  const created_at = new Date().toISOString()
  const position = (maxPos?.max ?? -1) + 1

  run('INSERT INTO habits (name, created_at, position) VALUES (?, ?, ?)', [
    trimmed,
    created_at,
    position
  ])
  const row = queryOne<{ id: number }>('SELECT last_insert_rowid() AS id')
  persist()

  return {
    id: Number(row?.id),
    name: trimmed,
    created_at,
    position
  }
}

export function deleteHabit(id: number): void {
  run('DELETE FROM habits WHERE id = ?', [id])
  persist()
}

/** Rewrite positions to match the given id order (0..n-1). */
export function reorderHabits(orderedIds: number[]): void {
  run('BEGIN')
  try {
    orderedIds.forEach((id, position) => {
      run('UPDATE habits SET position = ? WHERE id = ?', [position, id])
    })
    run('COMMIT')
    persist()
  } catch (error) {
    run('ROLLBACK')
    throw error
  }
}

export function getCompletions(startDate: string, endDate: string): CompletionsMap {
  const rows = queryAll<{ habit_id: number; date: string }>(
    `SELECT habit_id, date FROM completions
     WHERE date >= ? AND date <= ?
     ORDER BY date ASC`,
    [startDate, endDate]
  )

  const map: CompletionsMap = {}
  for (const row of rows) {
    if (!map[row.habit_id]) {
      map[row.habit_id] = []
    }
    map[row.habit_id].push(row.date)
  }
  return map
}

/** All completion dates per habit, ordered ascending — used for stats. */
export function getAllCompletions(): CompletionsMap {
  const rows = queryAll<{ habit_id: number; date: string }>(
    `SELECT habit_id, date FROM completions ORDER BY date ASC`
  )

  const map: CompletionsMap = {}
  for (const row of rows) {
    if (!map[row.habit_id]) {
      map[row.habit_id] = []
    }
    map[row.habit_id].push(row.date)
  }
  return map
}

export function todayLocal(): string {
  return formatDateKey(new Date())
}

/**
 * Earliest recorded date across habits: first completion, or habit creation
 * if nothing has been logged yet.
 */
export function getEarliestEntryDate(): string | null {
  const completion = queryOne<{ d: string | null }>('SELECT MIN(date) AS d FROM completions')?.d
  const createdIso = queryOne<{ d: string | null }>(
    'SELECT MIN(created_at) AS d FROM habits'
  )?.d
  const created = createdIso ? formatDateKey(new Date(createdIso)) : null

  const keys = [completion, created].filter((key): key is string => Boolean(key))
  if (keys.length === 0) return null
  keys.sort()
  return keys[0]
}

export function toggleCompletion(habitId: number, date: string): boolean {
  if (date > todayLocal()) {
    throw new Error('Cannot complete habits on a future date')
  }

  const existing = queryOne<{ ok: number }>(
    'SELECT 1 AS ok FROM completions WHERE habit_id = ? AND date = ?',
    [habitId, date]
  )

  if (existing) {
    run('DELETE FROM completions WHERE habit_id = ? AND date = ?', [habitId, date])
    persist()
    return false
  }

  run('INSERT INTO completions (habit_id, date) VALUES (?, ?)', [habitId, date])
  persist()
  return true
}
