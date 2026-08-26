# Habit Grid

A system-tray habit tracker with a GitHub-style contribution grid for **macOS** and **Windows**.
Each row is a habit; each column is a day. Completions are binary and stored locally with [sql.js](https://sql.js.org/) (SQLite compiled to WebAssembly).

Weeks are **Monday-first**, matching the GitHub contribution graph convention.

User data (including `habit-grid.db`) lives under the Electron `userData` directory named after the product:

| Mode | macOS | Windows |
|------|-------|---------|
| App data | `~/Library/Application Support/Habit Grid/` | `%APPDATA%\Habit Grid\` |

Older development builds may have used `…/habit-grid/`; `install:mac` copies that database into the product folder on first install when the destination is empty.

## Develop

Requires Node.js 20.11+.

```bash
npm install
npm run dev
```

Click the tray icon to open the grid. Right-click the tray icon for **Stats…**, **Open at Login**, and **Quit Habit Grid**.

```bash
npm run test:db   # schema / sql.js regression checks
npm run preview   # packaged-renderer preview
```

## Build

| Platform | Command | Output |
|----------|---------|--------|
| macOS (arm64 + x64 dir) | `npm run package:mac` | `dist/mac-arm64/`, `dist/mac/` (x64) or `dist/mac-x64/` |
| Windows (x64 portable) | `npm run package:win` | `dist/habit-grid-*-win-x64.exe` |
| macOS install to `/Applications` | `npm run install:mac` | (macOS host only) |

Release helpers (`npm run release:mac` / `release:win`) bump the patch version when sources change, then run the packaging script.

### Windows notes

- Builds are **portable** executables. Data lives under `%APPDATA%\Habit Grid\` (not next to the `.exe`).
- Each launch extracts into a temp folder. **Open at Login** registers the original portable `.exe` path (`PORTABLE_EXECUTABLE_FILE`) so startup survives re-extraction.
- The tray icon may sit in the notification overflow (`^`). The first launch opens the popup so the app is discoverable.

### macOS notes

- Unsigned local builds set `identity: null` (ad-hoc sign in `install:mac`).
- Development data historically lived under `~/Library/Application Support/habit-grid/`; packaged and current builds use `…/Habit Grid/`. `install:mac` copies the legacy development database into the product folder on first install only.

## Stack

- Electron + electron-vite
- React + TypeScript
- Tailwind CSS + shadcn-style UI primitives
- sql.js (WASM SQLite)
