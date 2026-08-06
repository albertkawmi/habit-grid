import { app, BrowserWindow, Menu, nativeImage, nativeTheme, screen, Tray } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

// Fits habit names + 3 full weeks (previous / current / following).
// Must match HabitGrid.popupContentWidth(): NAME_W(116) + px-3(24) + 21*15-3 = 452
const POPUP_WIDTH = 452
const MIN_HEIGHT = 130
const MAX_HEIGHT = 460
const TRAY_GAP = 6

let tray: Tray | null = null
let popup: BrowserWindow | null = null

function surfaceColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff'
}

export function getPopup(): BrowserWindow | null {
  return popup
}

export function createPopup(preloadPath: string): BrowserWindow {
  popup = new BrowserWindow({
    width: POPUP_WIDTH,
    height: MIN_HEIGHT,
    show: false,
    frame: false,
    // macOS draws the rounded corners and drop shadow for frameless windows.
    roundedCorners: true,
    hasShadow: true,
    backgroundColor: surfaceColor(),
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  popup.setAlwaysOnTop(true, 'floating')

  nativeTheme.on('updated', () => {
    popup?.setBackgroundColor(surfaceColor())
  })

  popup.on('blur', () => {
    // Deferred so a tray re-click or in-window focus shift doesn't flash-hide.
    setTimeout(() => {
      if (popup && !popup.isDestroyed() && !popup.isFocused()) {
        hidePopup()
      }
    }, 150)
  })

  popup.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      hidePopup()
    }
  })

  popup.on('closed', () => {
    popup = null
  })

  return popup
}

/** Sizes the popup to the dimensions the renderer reports for its content. */
export function resizePopup(height: number, width?: number): void {
  if (!popup || popup.isDestroyed()) return

  const nextHeight = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)))
  const nextWidth = Math.round(
    typeof width === 'number' && Number.isFinite(width) ? Math.max(POPUP_WIDTH, width) : POPUP_WIDTH
  )
  const bounds = popup.getBounds()
  if (bounds.height === nextHeight && bounds.width === nextWidth) return

  popup.setSize(nextWidth, nextHeight, false)
  if (popup.isVisible()) {
    positionNearTray()
  }
}

function positionNearTray(): void {
  if (!popup || !tray) return

  const trayBounds = tray.getBounds()
  const { width, height } = popup.getBounds()
  const { workArea } = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2)
  let y = Math.round(trayBounds.y + trayBounds.height + TRAY_GAP)

  x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - width - 8))
  if (y + height > workArea.y + workArea.height) {
    y = Math.round(trayBounds.y - height - TRAY_GAP)
  }

  popup.setPosition(x, y, false)
}

export function showPopup(): void {
  if (!popup) return
  positionNearTray()
  popup.show()
  popup.focus()
}

export function hidePopup(): void {
  if (popup && !popup.isDestroyed() && popup.isVisible()) {
    popup.hide()
  }
}

export function togglePopup(): void {
  if (!popup) return
  if (popup.isVisible()) {
    hidePopup()
  } else {
    showPopup()
  }
}

export function createTray(icon: Electron.NativeImage): Tray {
  tray = new Tray(icon)
  tray.setToolTip('Habit Grid')

  const menu = Menu.buildFromTemplate([
    {
      label: 'Quit Habit Grid',
      click: () => {
        hidePopup()
        app.quit()
      }
    }
  ])

  // Use popUpContextMenu on right-click only — setContextMenu also opens on left-click.
  tray.on('click', togglePopup)
  tray.on('right-click', () => {
    tray?.popUpContextMenu(menu)
  })
  return tray
}

export function resolveTrayIcon(): Electron.NativeImage {
  const candidates = [
    join(app.getAppPath(), 'resources/trayTemplate.png'),
    join(__dirname, '../../resources/trayTemplate.png'),
    join(process.cwd(), 'resources/trayTemplate.png')
  ]

  for (const path of candidates) {
    if (existsSync(path)) {
      const image = nativeImage.createFromPath(path)
      if (process.platform === 'darwin') {
        image.setTemplateImage(true)
      }
      return image
    }
  }

  const fallback = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAG0lEQVR42mNgGEzgPxImhj8IDRgNg9EwGMIAAFhJULCor54EAAAAAElFTkSuQmCC'
  )
  if (process.platform === 'darwin') {
    fallback.setTemplateImage(true)
  }
  return fallback
}
