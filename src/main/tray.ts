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
let popupPreloadPath: string | null = null
/** In-flight create+load, so overlapping tray clicks share one window. */
let popupLoad: Promise<BrowserWindow | null> | null = null
let hideOnBlurTimer: ReturnType<typeof setTimeout> | null = null
let saveWidthTimer: ReturnType<typeof setTimeout> | null = null
/** Ignore blur-hide until this time — accessory/tray focus is flaky right after show. */
let ignoreBlurUntil = 0
/** Height the renderer last requested; vertical resize is locked to this. */
let lockedHeight = MIN_HEIGHT
/** True while we are applying bounds ourselves — skip persist / height-fix recursion. */
let applyingBounds = false
/**
 * Last known usable tray icon rect. On Windows, `tray.getBounds()` is often
 * empty when the icon sits in the overflow area — prefer click-event bounds.
 */
let lastTrayBounds: Electron.Rectangle | null = null

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

function isUsableBounds(bounds: Electron.Rectangle | null | undefined): bounds is Electron.Rectangle {
  return Boolean(bounds && bounds.width > 0 && bounds.height > 0)
}

function rememberTrayBounds(bounds: Electron.Rectangle | undefined): void {
  if (isUsableBounds(bounds)) {
    lastTrayBounds = { ...bounds }
  }
}

/** Best-effort tray icon rect, or null when Windows reports an empty overflow icon. */
function resolveTrayBounds(): Electron.Rectangle | null {
  if (tray) {
    const live = tray.getBounds()
    if (isUsableBounds(live)) {
      lastTrayBounds = { ...live }
      return lastTrayBounds
    }
  }
  if (isUsableBounds(lastTrayBounds)) {
    return lastTrayBounds
  }
  return null
}

function anchorPoint(): Electron.Point {
  const trayBounds = resolveTrayBounds()
  if (trayBounds) {
    return {
      x: Math.round(trayBounds.x + trayBounds.width / 2),
      y: Math.round(trayBounds.y + trayBounds.height / 2)
    }
  }
  if (popup && !popup.isDestroyed()) {
    const bounds = popup.getBounds()
    return { x: bounds.x, y: bounds.y }
  }
  return screen.getCursorScreenPoint()
}

function workAreaMaxWidth(): number {
  const { workArea } = screen.getDisplayNearestPoint(anchorPoint())
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
  const trayBounds = resolveTrayBounds()
  if (trayBounds) {
    // Include the gap between tray and popup so moving between them doesn't dismiss.
    if (pointInBounds(point, trayBounds, TRAY_GAP)) return true
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

export function initPopup(preloadPath: string): void {
  popupPreloadPath = preloadPath
}

function loadPopup(win: BrowserWindow): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    return win.loadURL(process.env.ELECTRON_RENDERER_URL)
  }
  return win.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Returns the live popup, creating and loading it when it was closed or never built. */
export function ensurePopup(): Promise<BrowserWindow | null> {
  if (popup && !popup.isDestroyed()) return Promise.resolve(popup)
  if (popupLoad) return popupLoad
  if (!popupPreloadPath) return Promise.resolve(null)

  popupLoad = (async () => {
    const win = createPopup(popupPreloadPath!)
    try {
      await loadPopup(win)
    } catch (error) {
      if (!win.isDestroyed()) win.destroy()
      throw error
    }
    return win.isDestroyed() ? null : win
  })().finally(() => {
    popupLoad = null
  })
  return popupLoad
}

function createPopup(preloadPath: string): BrowserWindow {
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

  if (process.platform !== 'win32') {
    popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  if (process.platform === 'darwin') {
    popup.setAlwaysOnTop(true, 'floating')
  } else {
    popup.setAlwaysOnTop(true)
  }

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
  if (!popup) return

  const { width, height } = popup.getBounds()
  const trayBounds = resolveTrayBounds()
  const cursor = screen.getCursorScreenPoint()
  const anchorX = trayBounds
    ? trayBounds.x + trayBounds.width / 2
    : cursor.x
  const trayTop = trayBounds ? trayBounds.y : cursor.y
  const trayBottom = trayBounds ? trayBounds.y + trayBounds.height : cursor.y

  const display = screen.getDisplayNearestPoint({ x: Math.round(anchorX), y: Math.round(trayTop) })
  const { workArea, bounds: displayBounds } = display

  let x = Math.round(anchorX - width / 2)
  x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - width - 8))

  // Menu bar (macOS) sits in the top half; the Windows taskbar is usually at the bottom.
  // Place the popup into the work area on the open side of the tray.
  const trayInTopHalf = trayTop < displayBounds.y + displayBounds.height / 2
  let y: number
  if (trayInTopHalf) {
    y = Math.round(trayBottom + TRAY_GAP)
    // Tray coords can sit above the work area (in the menu bar) — pin under it.
    if (y < workArea.y) y = workArea.y + 4
    if (y + height > workArea.y + workArea.height) {
      y = Math.max(workArea.y + 4, workArea.y + workArea.height - height - 8)
    }
  } else {
    y = Math.round(trayTop - height - TRAY_GAP)
    if (y + height > workArea.y + workArea.height) {
      y = workArea.y + workArea.height - height - 8
    }
    if (y < workArea.y + 8) y = workArea.y + 8
  }

  withBounds(() => {
    popup!.setPosition(x, y, false)
  })
}

export async function showPopup(): Promise<void> {
  const win = await ensurePopup()
  if (!win || win.isDestroyed()) return
  clearHideOnBlurTimer()
  // Focus often fails to stick under activationPolicy: 'accessory'; suppress
  // blur-hide briefly so show-then-vanish races don't dismiss the popup.
  ignoreBlurUntil = Date.now() + 400
  refreshPopupWidthLimits()
  positionNearTray()
  win.show()
  win.focus()
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

export async function togglePopup(): Promise<void> {
  if (popup && !popup.isDestroyed() && popup.isVisible()) {
    hidePopup()
    return
  }
  await showPopup()
}

/**
 * Portable Windows builds extract to a temp dir each launch. Register the
 * original .exe path so login startup keeps working after re-extraction.
 */
function loginItemPathOptions(): Electron.LoginItemSettingsOptions {
  if (process.platform === 'win32') {
    const portable = process.env.PORTABLE_EXECUTABLE_FILE
    if (portable) {
      return { path: portable, args: [] }
    }
  }
  return {}
}

function buildTrayMenu(): Menu {
  const pathOptions = loginItemPathOptions()
  const { openAtLogin } = app.getLoginItemSettings(pathOptions)
  return Menu.buildFromTemplate([
    {
      label: 'Open at Login',
      type: 'checkbox',
      checked: openAtLogin,
      click: (item) => {
        const settings: Electron.Settings = {
          openAtLogin: item.checked
        }
        if (pathOptions.path) {
          settings.path = pathOptions.path
          settings.args = pathOptions.args ?? []
        }
        app.setLoginItemSettings(settings)
        // Reflect the OS result — portable path / policy can reject registration.
        item.checked = app.getLoginItemSettings(pathOptions).openAtLogin
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
  rememberTrayBounds(tray.getBounds())

  // Use popUpContextMenu on right-click only — setContextMenu also opens on left-click.
  // Rebuild each time so the Open at Login checkbox matches System Settings.
  tray.on('click', (_event, bounds) => {
    rememberTrayBounds(bounds)
    void togglePopup().catch((error: unknown) => {
      console.error('Failed to open Habit Grid', error)
    })
  })
  tray.on('right-click', (_event, bounds) => {
    rememberTrayBounds(bounds)
    tray?.popUpContextMenu(buildTrayMenu())
  })
  return tray
}

function resourceCandidates(fileName: string): string[] {
  return [
    join(app.getAppPath(), 'resources', fileName),
    join(__dirname, '../../resources', fileName),
    join(process.cwd(), 'resources', fileName)
  ]
}

export function resolveTrayIcon(): Electron.NativeImage {
  const names =
    process.platform === 'win32'
      ? ['tray-win.png', 'trayTemplate.png']
      : ['trayTemplate.png']

  for (const name of names) {
    for (const path of resourceCandidates(name)) {
      if (!existsSync(path)) continue
      const image = nativeImage.createFromPath(path)
      if (image.isEmpty()) continue
      if (process.platform === 'darwin' && name.startsWith('trayTemplate')) {
        image.setTemplateImage(true)
      }
      return image
    }
  }

  const fallbackData =
    process.platform === 'win32'
      ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAnElEQVR42u2XQQ6AIAwEeYsP87e+S+OVgO5uuwGMm3DtzAFKW8ofMtuxn09nGNgmwoJTRaLwkEQWXJLIhlMSLjgsMVTAAbwDSzjgsIAL3hJoSrjgYYFeARSeIoBKoHBJ4E2CgcsCvaIsPCRQF1fg9CvoQVS41AuQhNuxcstZePg/sMLRjqjC02YCKxy9kEvNheuO5VMsJtOsZp/NBXEICYP7mVj+AAAAAElFTkSuQmCC'
      : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAG0lEQVR42mNgGEzgPxImhj8IDRgNg9EwGMIAAFhJULCor54EAAAAAElFTkSuQmCC'
  const fallback = nativeImage.createFromDataURL(fallbackData)
  if (process.platform === 'darwin') {
    fallback.setTemplateImage(true)
  }
  return fallback
}
