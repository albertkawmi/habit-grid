import { app, dialog, ipcMain } from 'electron'
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
import { getStats } from './stats'
import { destroyStatsWindow, initStatsWindow } from './stats-window'
import {
  createPopup,
  createTray,
  getPopup,
  persistPopupWidth,
  refreshPopupWidthLimits,
  resizePopup,
  resolveTrayIcon,
  showPopup
} from './tray'

// Prevent multiple instances from fighting over the tray.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Bring the existing tray popup forward when the user re-launches the app.
    showPopup()
  })

  if (process.platform === 'darwin') {
    // Must be set before ready — hides Dock / Cmd-Tab for tray apps.
    app.setActivationPolicy('accessory')
  }

  function registerIpcHandlers(): void {
    ipcMain.handle('habits:list', () => listHabits())
    ipcMain.handle('habits:add', (_event, name: string) => {
      const habit = addHabit(name)
      refreshPopupWidthLimits()
      return habit
    })
    ipcMain.handle('habits:delete', (_event, id: number) => {
      deleteHabit(id)
      refreshPopupWidthLimits()
    })
    ipcMain.handle('habits:reorder', (_event, orderedIds: number[]) => {
      reorderHabits(orderedIds)
    })
    ipcMain.handle('completions:getRange', (_event, startDate: string, endDate: string) =>
      getCompletions(startDate, endDate)
    )
    ipcMain.handle('completions:toggle', (_event, habitId: number, date: string) => {
      const status = toggleCompletion(habitId, date)
      refreshPopupWidthLimits()
      return status
    })
    ipcMain.handle('stats:get', () => getStats())
    ipcMain.handle('app:resize', (_event, height: number) => {
      resizePopup(height)
    })
  }

  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('com.albert.habit-grid')

      if (process.platform === 'darwin') {
        app.dock?.hide()
      }

      await initDb()

      const preloadPath = join(__dirname, '../preload/index.js')
      initStatsWindow(preloadPath)
      const popup = createPopup(preloadPath)
      registerIpcHandlers()

      if (process.env.ELECTRON_RENDERER_URL) {
        await popup.loadURL(process.env.ELECTRON_RENDERER_URL)
      } else {
        await popup.loadFile(join(__dirname, '../renderer/index.html'))
      }

      createTray(resolveTrayIcon())

      // Make the first Windows launch discoverable instead of relying on a newly
      // installed tray icon that Windows may move into its overflow area.
      if (process.platform === 'win32') {
        showPopup()
      }
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)
      dialog.showErrorBox('Habit Grid failed to start', message)
      app.quit()
    })

  app.on('window-all-closed', () => {
    // Tray apps keep running until explicitly quit.
  })

  app.on('before-quit', () => {
    persistPopupWidth()
    const popup = getPopup()
    if (popup && !popup.isDestroyed()) {
      popup.destroy()
    }
    destroyStatsWindow()
  })
}
