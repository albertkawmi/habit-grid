# Habit Grid

A macOS system-tray habit tracker with a GitHub-style contribution grid.
Each row is a habit; each column is a day. Completions are binary and stored locally in SQLite.

## Develop

```bash
npm install
npm run dev
```

Click the menu-bar tray icon to open the grid. Use **Quit** in the popup to exit.

## Stack

- Electron + electron-vite
- React + TypeScript
- Tailwind CSS + shadcn-style UI primitives
- better-sqlite3
