import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packageScript = process.argv[2]

if (!packageScript) {
  throw new Error('Expected an npm packaging script name.')
}

function git(...args) {
  return execFileSync('git', args, { cwd: root })
}

/** Resolve the real git metadata dir (works for linked worktrees). */
function gitCommonDir() {
  try {
    return git('rev-parse', '--git-common-dir').toString().trim()
  } catch {
    return join(root, '.git')
  }
}

function resolveGitPath(relative) {
  const common = gitCommonDir()
  const absoluteCommon = common.startsWith('/') || /^[A-Za-z]:[\\/]/.test(common)
    ? common
    : join(root, common)
  return join(absoluteCommon, relative)
}

const statePath = resolveGitPath(join('habit-grid-builds', 'version-source.sha256'))

function sourceFingerprint() {
  const hash = createHash('sha256')
  const sourceFiles = git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
    .toString()
    .split('\0')
    .filter(Boolean)
    .sort()

  for (const path of sourceFiles) {
    hash.update(path)
    const fullPath = join(root, path)
    hash.update(existsSync(fullPath) ? readFileSync(fullPath) : '<deleted>')
  }

  return hash.digest('hex')
}

const previousFingerprint = existsSync(statePath) ? readFileSync(statePath, 'utf8').trim() : null
let fingerprint = sourceFingerprint()

if (fingerprint !== previousFingerprint) {
  console.log('Source changed since the last release build; incrementing the patch version.')
  execFileSync(npm, ['version', 'patch', '--no-git-tag-version'], {
    cwd: root,
    stdio: 'inherit'
  })

  fingerprint = sourceFingerprint()
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${fingerprint}\n`)
} else {
  console.log('Source is unchanged; keeping the current version.')
}

execFileSync(npm, ['run', packageScript], {
  cwd: root,
  stdio: 'inherit'
})
