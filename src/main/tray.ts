import { app, BrowserWindow, Menu, nativeImage, nativeTheme, screen, Tray } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { showStatsWindow } from './stats-window'

// Fits habit names + default visible range (previous Monday through today+7).
// Floor = Monday case (15 days). Must stay ≤ HabitGrid.popupContentWidth() min:
// NAME_W(116) + px-3(24) + 15*15-3 = 362. Renderer widens up to 21 days on Sunday.
const POPUP_WIDTH = 362
const MIN_HEIGHT = 130
const MAX_HEIGHT = 460
const TRAY_GAP = 6

let tray: Tray | null = null
let popup: BrowserWindow | null = null
let hideOnBlurTimer: ReturnType<typeof setTimeout> | null = null
/** Ignore blur-hide until this time — accessory/tray focus is flaky right after show. */
let ignoreBlurUntil = 0

function surfaceColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff'
}

function clearHideOnBlurTimer(): void {
  if (hideOnBlurTimer !== null) {
    clearTimeout(hideOnBlurTimer)
    hideOnBlurTimer = null
  }
}

function pointInBounds(
  point: Electron.Point,
  bounds: Electron.Rectangle,
  padding = 0
): boolean {
  return (
    point.x >= bounds.x - padding &&
    point.x <= bounds.x + bounds.width + padding &&
    point.y >= bounds.y - padding &&
    point.y <= bounds.y + bounds.height + padding
  )
}

/** True when the cursor is over the popup or tray (not a “click outside”). */
function cursorOverPopupOrTray(): boolean {
  if (!popup || popup.isDestroyed()) return false
  const point = screen.getCursorScreenPoint()
  if (pointInBounds(point, popup.getBounds(), 2)) return true
  if (tray) {
    // Include the gap between tray and popup so moving between them doesn't dismiss.
    if (pointInBounds(point, tray.getBounds(), TRAY_GAP)) return true
  }
  return false
}

function scheduleHideOnOutsideBlur(): void {
  clearHideOnBlurTimer()
  // Deferred so tray re-clicks / brief focus churn don't flash-hide.
  hideOnBlurTimer = setTimeout(() => {
    hideOnBlurTimer = null
    if (!popup || popup.isDestroyed() || !popup.isVisible()) return
    if (Date.now() < ignoreBlurUntil) return
    // Stay open unless the cursor is clearly outside popup + tray.
    // Blur alone is not enough under activationPolicy: 'accessory' — macOS often
    // steals key window without a user click outside.
    if (cursorOverPopupOrTray()) return
    hidePopup()
  }, 200)
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
    // Panel-style windows keep tray popups more stable under accessory activation.
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
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
    scheduleHideOnOutsideBlur()
  })

  popup.on('focus', () => {
    clearHideOnBlurTimer()
  })

  popup.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      hidePopup()
    }
  })

  popup.on('closed', () => {
    clearHideOnBlurTimer()
    popup = null
  })

  return popup
}

/** Sizes the popup to the dimensions the renderer reports for its content. */
export function resizePopup(height: number, width?: number): void {
  if (!popup || popup.isDestroyed()) return

  const nextHeight = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)))
  const nextWidth = Math.round(
    typeof width === 'number' && Number.isFinite(width) ? width : POPUP_WIDTH
  )
  const bounds = popup.getBounds()
  if (bounds.height === nextHeight && bounds.width === nextWidth) return

  // Geometry changes can jostle focus on accessory windows — don't treat as dismiss.
  if (popup.isVisible()) {
    ignoreBlurUntil = Math.max(ignoreBlurUntil, Date.now() + 250)
  }
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
  clearHideOnBlurTimer()
  // Focus often fails to stick under activationPolicy: 'accessory'; suppress
  // blur-hide briefly so show-then-vanish races don't dismiss the popup.
  ignoreBlurUntil = Date.now() + 400
  positionNearTray()
  popup.show()
  popup.focus()
}

export function hidePopup(): void {
  clearHideOnBlurTimer()
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

function buildTrayMenu(): Menu {
  const { openAtLogin } = app.getLoginItemSettings()
  return Menu.buildFromTemplate([
    {
      label: 'Open at Login',
      type: 'checkbox',
      checked: openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked })
      }
    },
    { type: 'separator' },
    {
      label: 'Stats…',
      click: () => {
        void showStatsWindow()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Habit Grid',
      click: () => {
        hidePopup()
        app.quit()
      }
    }
  ])
}

export function createTray(icon: Electron.NativeImage): Tray {
  tray = new Tray(icon)
  tray.setToolTip('Habit Grid')

  // Use popUpContextMenu on right-click only — setContextMenu also opens on left-click.
  // Rebuild each time so the Open at Login checkbox matches System Settings.
  tray.on('click', togglePopup)
  tray.on('right-click', () => {
    tray?.popUpContextMenu(buildTrayMenu())
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
