import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'

const STATS_WIDTH = 520
const STATS_HEIGHT = 640

let statsWindow: BrowserWindow | null = null
let preloadPath: string | null = null

function surfaceColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff'
}

export function initStatsWindow(preload: string): void {
  preloadPath = preload
}

export function getStatsWindow(): BrowserWindow | null {
  return statsWindow
}

export function destroyStatsWindow(): void {
  if (statsWindow && !statsWindow.isDestroyed()) {
    statsWindow.destroy()
  }
  statsWindow = null
}

export async function showStatsWindow(): Promise<void> {
  if (!preloadPath) return

  if (statsWindow && !statsWindow.isDestroyed()) {
    if (statsWindow.isMinimized()) statsWindow.restore()
    statsWindow.show()
    statsWindow.focus()
    return
  }

  statsWindow = new BrowserWindow({
    width: STATS_WIDTH,
    height: STATS_HEIGHT,
    minWidth: 400,
    minHeight: 360,
    show: false,
    title: 'Stats',
    backgroundColor: surfaceColor(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const onThemeUpdated = (): void => {
    statsWindow?.setBackgroundColor(surfaceColor())
  }
  nativeTheme.on('updated', onThemeUpdated)

  statsWindow.on('closed', () => {
    nativeTheme.off('updated', onThemeUpdated)
    statsWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await statsWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#stats`)
  } else {
    await statsWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'stats' })
  }
  statsWindow.show()
  statsWindow.focus()
}
