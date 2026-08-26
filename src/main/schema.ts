import type { Database, SqlValue } from 'sql.js'

/** Bump when adding migrations that alter existing tables. */
export const SCHEMA_VERSION = 1

/**
 * sql.js only runs multi-statement SQL when the params argument is omitted.
 * Passing `[]` is truthy and switches to prepare/step (first statement only).
 */
export function runSql(db: Database, sql: string, params?: SqlValue[]): void {
  if (params === undefined) {
    db.run(sql)
  } else {
    db.run(sql, params)
  }
}

function queryAll<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
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

function queryOne<T>(db: Database, sql: string, params: SqlValue[] = []): T | undefined {
  return queryAll<T>(db, sql, params)[0]
}

export function listTables(db: Database): Set<string> {
  const rows = queryAll<{ name: string }>(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  )
  return new Set(rows.map((row) => row.name))
}

/**
 * Create required tables and advance schema version.
 * Each CREATE runs as its own statement so sql.js cannot drop later DDL.
 * Safe to call on already-migrated DBs and on habits-only broken installs.
 */
export function applySchema(db: Database): void {
  // Separate statements — never pass an empty params array to multi-statement SQL.
  runSql(
    db,
    `
    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      position INTEGER NOT NULL
    )
  `
  )
  runSql(
    db,
    `
    CREATE TABLE IF NOT EXISTS completions (
      habit_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      PRIMARY KEY (habit_id, date),
      FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
    )
  `
  )

  const version = Number(queryOne<{ user_version: number }>(db, 'PRAGMA user_version')?.user_version ?? 0)
  if (version < SCHEMA_VERSION) {
    // Future migrations for version < N go here before bumping.
    runSql(db, `PRAGMA user_version = ${SCHEMA_VERSION}`)
  }

  const tables = listTables(db)
  for (const required of ['habits', 'completions']) {
    if (!tables.has(required)) {
      throw new Error(`Database schema incomplete: missing table "${required}"`)
    }
  }
}
