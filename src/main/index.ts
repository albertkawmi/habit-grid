import { app, ipcMain } from 'electron'
import { join } from 'path'
import {
  addHabit,
  deleteHabit,
  getCompletions,
  initDb,
  listHabits,
  reorderHabits,
  toggleCompletion
} from './db'
import {
  createPopup,
  createTray,
  getPopup,
  resizePopup,
  resolveTrayIcon
} from './tray'

// Prevent multiple instances from fighting over the tray.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

if (process.platform === 'darwin') {
  // Must be set before ready — hides Dock / Cmd-Tab for tray apps.
  app.setActivationPolicy('accessory')
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    app.dock?.hide()
  }

  await initDb()

  const preloadPath = join(__dirname, '../preload/index.js')
  const popup = createPopup(preloadPath)

  if (process.env.ELECTRON_RENDERER_URL) {
    await popup.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await popup.loadFile(join(__dirname, '../renderer/index.html'))
  }

  createTray(resolveTrayIcon())

  ipcMain.handle('habits:list', () => listHabits())
  ipcMain.handle('habits:add', (_event, name: string) => addHabit(name))
  ipcMain.handle('habits:delete', (_event, id: number) => {
    deleteHabit(id)
  })
  ipcMain.handle('habits:reorder', (_event, orderedIds: number[]) => {
    reorderHabits(orderedIds)
  })
  ipcMain.handle('completions:getRange', (_event, startDate: string, endDate: string) =>
    getCompletions(startDate, endDate)
  )
  ipcMain.handle('completions:toggle', (_event, habitId: number, date: string) =>
    toggleCompletion(habitId, date)
  )
  ipcMain.handle('app:resize', (_event, height: number, width: number) => {
    resizePopup(height, width)
  })
})

app.on('window-all-closed', () => {
  // Tray apps keep running until explicitly quit.
})

app.on('before-quit', () => {
  const popup = getPopup()
  if (popup && !popup.isDestroyed()) {
    popup.destroy()
  }
})
