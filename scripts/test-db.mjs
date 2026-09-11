/**
 * Regression tests for sql.js schema bootstrap.
 * Mirrors src/main/schema.ts so we catch the empty-params multi-statement bug
 * without loading Electron.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const initSqlJs = require('sql.js')
const __dirname = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(dirname(require.resolve('sql.js')), 'sql-wasm.wasm')

const SCHEMA_VERSION = 2

function runSql(db, sql, params) {
  if (params === undefined) {
    db.run(sql)
  } else {
    db.run(sql, params)
  }
}

function listTables(db) {
  const result = db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  if (!result.length) return []
  return result[0].values.map(([name]) => name)
}

function listColumns(db, table) {
  const result = db.exec(`PRAGMA table_info(${table})`)
  if (!result.length) return []
  const nameIndex = result[0].columns.indexOf('name')
  return result[0].values.map((row) => row[nameIndex])
}

function applySchema(db) {
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
      status TEXT NOT NULL DEFAULT 'done',
      PRIMARY KEY (habit_id, date),
      FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
    )
  `
  )

  const versionRow = db.exec('PRAGMA user_version')
  const version = versionRow.length ? Number(versionRow[0].values[0][0]) : 0
  if (version < 2) {
    const tables = new Set(listTables(db))
    if (tables.has('completions') && !listColumns(db, 'completions').includes('status')) {
      runSql(db, `ALTER TABLE completions ADD COLUMN status TEXT NOT NULL DEFAULT 'done'`)
    }
  }
  if (version < SCHEMA_VERSION) {
    runSql(db, `PRAGMA user_version = ${SCHEMA_VERSION}`)
  }

  const tables = new Set(listTables(db))
  for (const required of ['habits', 'completions']) {
    if (!tables.has(required)) {
      throw new Error(`Database schema incomplete: missing table "${required}"`)
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const SQL = await initSqlJs({ locateFile: () => wasmPath })

  // 1) Document the sql.js pitfall we fixed.
  {
    const broken = new SQL.Database()
    broken.run(
      `CREATE TABLE a (id INTEGER); CREATE TABLE b (id INTEGER);`,
      []
    )
    const tables = listTables(broken)
    assert(
      tables.length === 1 && tables[0] === 'a',
      `Expected empty-params multi-statement to create only "a", got: ${tables.join(',')}`
    )
    broken.close()
    console.log('ok - empty params array executes only the first statement')
  }

  // 2) Clean database gets both tables + schema version + status column.
  {
    const db = new SQL.Database()
    applySchema(db)
    const tables = listTables(db)
    assert(
      tables.includes('habits') && tables.includes('completions'),
      `Clean schema missing tables: ${tables.join(',')}`
    )
    const version = Number(db.exec('PRAGMA user_version')[0].values[0][0])
    assert(version === SCHEMA_VERSION, `Expected user_version ${SCHEMA_VERSION}, got ${version}`)
    assert(
      listColumns(db, 'completions').includes('status'),
      'Clean completions table should include status'
    )
    db.close()
    console.log('ok - clean database creates habits and completions')
  }

  // 3) Habits-only (broken) DB is healed; existing rows survive.
  {
    const db = new SQL.Database()
    db.run(`
      CREATE TABLE habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        position INTEGER NOT NULL
      )
    `)
    db.run(`INSERT INTO habits (name, created_at, position) VALUES ('Read', '2026-01-01T00:00:00.000Z', 0)`)
    assert(listTables(db).join(',') === 'habits', 'Fixture should start with habits only')

    applySchema(db)

    const tables = listTables(db)
    assert(
      tables.includes('habits') && tables.includes('completions'),
      `Healed schema missing tables: ${tables.join(',')}`
    )
    const rows = db.exec('SELECT name FROM habits')
    assert(rows[0].values[0][0] === 'Read', 'Existing habit row was lost during heal')
    db.close()
    console.log('ok - habits-only database is healed and rows are preserved')
  }

  // 4) Idempotent re-apply.
  {
    const db = new SQL.Database()
    applySchema(db)
    applySchema(db)
    assert(listTables(db).length === 2, 'Re-apply should leave exactly two app tables')
    db.close()
    console.log('ok - applySchema is idempotent')
  }

  // 5) v1 completions without status migrate and keep existing rows as done.
  {
    const db = new SQL.Database()
    db.run(`
      CREATE TABLE habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        position INTEGER NOT NULL
      )
    `)
    db.run(`
      CREATE TABLE completions (
        habit_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        PRIMARY KEY (habit_id, date),
        FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
      )
    `)
    db.run(`INSERT INTO habits (name, created_at, position) VALUES ('Read', '2026-01-01T00:00:00.000Z', 0)`)
    db.run(`INSERT INTO completions (habit_id, date) VALUES (1, '2026-01-02')`)
    db.run('PRAGMA user_version = 1')

    applySchema(db)

    assert(listColumns(db, 'completions').includes('status'), 'Migration should add status')
    const version = Number(db.exec('PRAGMA user_version')[0].values[0][0])
    assert(version === SCHEMA_VERSION, `Expected user_version ${SCHEMA_VERSION}, got ${version}`)
    const row = db.exec('SELECT date, status FROM completions')
    assert(row[0].values[0][0] === '2026-01-02', 'Existing completion date was lost')
    assert(row[0].values[0][1] === 'done', `Expected default status done, got ${row[0].values[0][1]}`)
    db.close()
    console.log('ok - v1 completions migrate to status=done')
  }

  console.log(`\nAll database regression checks passed (${wasmPath.includes('sql.js') ? 'sql.js' : 'ok'}).`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
