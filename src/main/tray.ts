import { app, BrowserWindow, Menu, nativeImage, nativeTheme, screen, Tray } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { maxPopupWidth, minPopupWidth } from '../shared/popup-layout'
import { getEarliestEntryDate } from './db'
import { showStatsWindow } from './stats-window'

const MIN_HEIGHT = 130
const MAX_HEIGHT = 460
const TRAY_GAP = 6
const SCREEN_MARGIN = 16
const WIDTH_STATE_FILE = 'popup-width.json'

let tray: Tray | null = null
let popup: BrowserWindow | null = null
let hideOnBlurTimer: ReturnType<typeof setTimeout> | null = null
let saveWidthTimer: ReturnType<typeof setTimeout> | null = null
/** Ignore blur-hide until this time — accessory/tray focus is flaky right after show. */
let ignoreBlurUntil = 0
/** Height the renderer last requested; vertical resize is locked to this. */
let lockedHeight = MIN_HEIGHT
/** True while we are applying bounds ourselves — skip persist / height-fix recursion. */
let applyingBounds = false

function surfaceColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff'
}

function widthStatePath(): string {
  return join(app.getPath('userData'), WIDTH_STATE_FILE)
}

function readSavedWidth(): number | null {
  try {
    const raw = JSON.parse(readFileSync(widthStatePath(), 'utf8')) as { width?: unknown }
    if (typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width > 0) {
      return Math.round(raw.width)
    }
  } catch {
    // Missing or invalid state — fall back to the default viewport width.
  }
  return null
}

function writeSavedWidth(width: number): void {
  writeFileSync(widthStatePath(), `${JSON.stringify({ width: Math.round(width) })}\n`)
}

function persistWidthSoon(): void {
  if (saveWidthTimer !== null) clearTimeout(saveWidthTimer)
  saveWidthTimer = setTimeout(() => {
    saveWidthTimer = null
    if (!popup || popup.isDestroyed()) return
    writeSavedWidth(popup.getBounds().width)
  }, 200)
}

function workAreaMaxWidth(): number {
  const point = tray
    ? { x: tray.getBounds().x, y: tray.getBounds().y }
    : popup && !popup.isDestroyed()
      ? { x: popup.getBounds().x, y: popup.getBounds().y }
      : screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(point)
  return workArea.width - SCREEN_MARGIN
}

function widthLimits(): { min: number; max: number } {
  const min = Math.round(minPopupWidth())
  const dataMax = Math.round(maxPopupWidth(getEarliestEntryDate()))
  const max = Math.max(min, Math.min(dataMax, workAreaMaxWidth()))
  return { min, max }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function withBounds(fn: () => void): void {
  applyingBounds = true
  try {
    fn()
  } finally {
    applyingBounds = false
  }
}

/** Lock height and apply min/max width. Optionally set an explicit width. */
function applyWindowBox(height: number, width?: number): void {
  if (!popup || popup.isDestroyed()) return

  const { min, max } = widthLimits()
  const nextHeight = Math.round(clamp(height, MIN_HEIGHT, MAX_HEIGHT))
  const bounds = popup.getBounds()
  const nextWidth = Math.round(
    clamp(typeof width === 'number' && Number.isFinite(width) ? width : bounds.width, min, max)
  )
  lockedHeight = nextHeight

  const [minW, minH] = popup.getMinimumSize()
  const [maxW, maxH] = popup.getMaximumSize()
  if (
    bounds.width === nextWidth &&
    bounds.height === nextHeight &&
    minW === min &&
    maxW === max &&
    minH === nextHeight &&
    maxH === nextHeight
  ) {
    return
  }

  withBounds(() => {
    // Temporarily lift limits so Electron will accept the new box, then re-lock.
    popup!.setMinimumSize(1, 1)
    popup!.setMaximumSize(16384, 16384)
    popup!.setSize(nextWidth, nextHeight, false)
    popup!.setMinimumSize(min, nextHeight)
    popup!.setMaximumSize(max, nextHeight)
  })
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
  const { min, max } = widthLimits()
  const saved = readSavedWidth()
  const width = clamp(saved ?? min, min, max)
  lockedHeight = MIN_HEIGHT

  popup = new BrowserWindow({
    width,
    height: MIN_HEIGHT,
    minWidth: min,
    maxWidth: max,
    minHeight: MIN_HEIGHT,
    maxHeight: MIN_HEIGHT,
    show: false,
    frame: false,
    // macOS draws the rounded corners and drop shadow for frameless windows.
    roundedCorners: true,
    hasShadow: true,
    backgroundColor: surfaceColor(),
    resizable: true,
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

  // Width-only: keep the vertical box fixed while the user drags an edge.
  popup.on('will-resize', (_event, newBounds) => {
    const current = popup!.getBounds()
    newBounds.height = current.height
    newBounds.y = current.y
  })

  popup.on('resize', () => {
    if (!popup || popup.isDestroyed() || applyingBounds) return
    const bounds = popup.getBounds()
    if (bounds.height !== lockedHeight) {
      withBounds(() => {
        popup!.setSize(bounds.width, lockedHeight, false)
      })
    }
    // Geometry changes can jostle focus on accessory windows — don't treat as dismiss.
    ignoreBlurUntil = Math.max(ignoreBlurUntil, Date.now() + 250)
    persistWidthSoon()
  })

  popup.on('closed', () => {
    clearHideOnBlurTimer()
    if (saveWidthTimer !== null) {
      clearTimeout(saveWidthTimer)
      saveWidthTimer = null
    }
    popup = null
  })

  return popup
}

/** Sizes the popup height to the content the renderer reports. Width is user-owned. */
export function resizePopup(height: number): void {
  if (!popup || popup.isDestroyed()) return

  const nextHeight = Math.round(clamp(height, MIN_HEIGHT, MAX_HEIGHT))
  const bounds = popup.getBounds()
  if (bounds.height === nextHeight && lockedHeight === nextHeight) {
    refreshPopupWidthLimits()
    return
  }

  if (popup.isVisible()) {
    ignoreBlurUntil = Math.max(ignoreBlurUntil, Date.now() + 250)
  }
  applyWindowBox(nextHeight)
  if (popup.isVisible()) {
    positionNearTray()
  }
}

/** Recompute min/max width after habit data changes (clamps if the current width is now illegal). */
export function refreshPopupWidthLimits(): void {
  if (!popup || popup.isDestroyed()) return
  applyWindowBox(lockedHeight)
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

  withBounds(() => {
    popup!.setPosition(x, y, false)
  })
}

export function showPopup(): void {
  if (!popup) return
  clearHideOnBlurTimer()
  // Focus often fails to stick under activationPolicy: 'accessory'; suppress
  // blur-hide briefly so show-then-vanish races don't dismiss the popup.
  ignoreBlurUntil = Date.now() + 400
  refreshPopupWidthLimits()
  positionNearTray()
  popup.show()
  popup.focus()
}

export function persistPopupWidth(): void {
  if (saveWidthTimer !== null) {
    clearTimeout(saveWidthTimer)
    saveWidthTimer = null
  }
  if (popup && !popup.isDestroyed()) {
    writeSavedWidth(popup.getBounds().width)
  }
}

export function hidePopup(): void {
  clearHideOnBlurTimer()
  if (popup && !popup.isDestroyed() && popup.isVisible()) {
    persistPopupWidth()
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
