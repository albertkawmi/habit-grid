import { app, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron'
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
  createTray,
  ensurePopup,
  getPopup,
  initPopup,
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
    void showPopup()
  })

  if (process.platform === 'darwin') {
    // Must be set before ready — hides Dock / Cmd-Tab for tray apps.
    app.setActivationPolicy('accessory')
  }

  function installApplicationMenu(): void {
    // Replace Electron's default menu. Its hidden Close Window item (⌘W / Ctrl+W)
    // calls close() on the focused popup and destroys it.
    // Keep Edit so text shortcuts still work; omit close, hide, and minimize.
    const template: MenuItemConstructorOptions[] = [
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      }
    ]
    if (process.platform === 'darwin') {
      template.unshift({
        label: app.name,
        submenu: [{ role: 'quit' }]
      })
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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
      installApplicationMenu()
      app.setAppUserModelId('com.albert.habit-grid')

      if (process.platform === 'darwin') {
        app.dock?.hide()
      }

      await initDb()

      const preloadPath = join(__dirname, '../preload/index.js')
      initStatsWindow(preloadPath)
      initPopup(preloadPath)
      registerIpcHandlers()
      await ensurePopup()

      createTray(resolveTrayIcon())

      // Make the first Windows launch discoverable instead of relying on a newly
      // installed tray icon that Windows may move into its overflow area.
      if (process.platform === 'win32') {
        await showPopup()
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
