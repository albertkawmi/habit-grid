#!/usr/bin/env node
/**
 * Cross-platform electron-vite launcher.
 * Cursor / some shells set ELECTRON_RUN_AS_NODE=1, which breaks Electron.
 * `env -u` is Unix-only — delete the variable here instead.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node scripts/run-electron-vite.mjs <electron-vite-args…>')
  process.exit(1)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const require = createRequire(import.meta.url)
const electronViteBin = join(
  dirname(require.resolve('electron-vite/package.json')),
  'bin',
  'electron-vite.js'
)

const child = spawn(process.execPath, [electronViteBin, ...args], {
  env,
  stdio: 'inherit',
  windowsHide: false
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
