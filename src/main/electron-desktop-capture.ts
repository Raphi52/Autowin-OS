import {
  desktopCapturer,
  nativeImage,
  screen,
  type Display,
  type DesktopCapturerSource
} from 'electron'
import { execFile } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import type { DesktopObservation } from './desktop-control'

const MAX_WIDTH = 2560
const MAX_HEIGHT = 1440
const JPEG_QUALITY = 82
const CAPTURE_ATTEMPTS = 3

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface PhysicalDisplayLayout extends Rect {
  id: number
}

type DisplayLayoutInput = Pick<Display, 'id' | 'bounds' | 'scaleFactor'>

/** Convertit la geometrie DIP d'Electron dans le repere physique utilise par Windows. */
export function physicalDisplayLayout(
  display: DisplayLayoutInput,
  physicalOrigin: { x: number; y: number }
): PhysicalDisplayLayout {
  return {
    id: display.id,
    left: Math.round(physicalOrigin.x),
    top: Math.round(physicalOrigin.y),
    width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
  }
}

interface ForegroundRect extends Rect {
  handle: string
}

const FOREGROUND_RECT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AutowinForegroundWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError = true)] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  public static void UsePhysicalCoordinates() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (EntryPointNotFoundException) { }
    SetProcessDPIAware();
  }
}
'@
[AutowinForegroundWindow]::UsePhysicalCoordinates()
$handle = [AutowinForegroundWindow]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) { throw 'Aucune fenetre Windows active' }
$rect = New-Object AutowinForegroundWindow+RECT
if (-not [AutowinForegroundWindow]::GetWindowRect($handle, [ref]$rect)) { throw 'GetWindowRect a echoue' }
$result = @{
  handle = $handle.ToInt64().ToString()
  left = $rect.Left; top = $rect.Top
  width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top
}
[Console]::Out.Write(($result | ConvertTo-Json -Compress))
`

function windowRect(handle?: string): Promise<ForegroundRect> {
  if (handle !== undefined && !/^\d+$/.test(handle)) {
    return Promise.reject(new Error('Handle de fenetre Windows invalide'))
  }
  const script = handle
    ? FOREGROUND_RECT_SCRIPT.replace(
        '$handle = [AutowinForegroundWindow]::GetForegroundWindow()',
        `$handle = [IntPtr]([long]'${handle}')`
      )
    : FOREGROUND_RECT_SCRIPT
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf8', windowsHide: true, timeout: 5_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message).trim()))
          return
        }
        try {
          const parsed = JSON.parse(String(stdout)) as ForegroundRect
          if (
            typeof parsed.handle !== 'string' ||
            !Number.isInteger(parsed.left) ||
            !Number.isInteger(parsed.top) ||
            !Number.isInteger(parsed.width) ||
            !Number.isInteger(parsed.height) ||
            parsed.width <= 0 ||
            parsed.height <= 0
          ) {
            throw new Error('Geometrie invalide')
          }
          resolve(parsed)
        } catch (parseError) {
          reject(
            new Error(
              `Reponse de fenetre active invalide: ${parseError instanceof Error ? parseError.message : parseError}`
            )
          )
        }
      }
    )
  })
}

function hasVisiblePixels(pixels: Buffer): boolean {
  const sampleStep = Math.max(4, Math.floor(pixels.length / (512 * 4)) * 4)
  for (let byte = 0; byte < pixels.length - 2; byte += sampleStep) {
    if (pixels[byte] > 4 || pixels[byte + 1] > 4 || pixels[byte + 2] > 4) return true
  }
  return false
}

function observation(
  jpeg: Buffer,
  imageSize: { width: number; height: number },
  source: Rect,
  scope: DesktopObservation['data']['scope'],
  displayInfo: { displays: number; display?: number } = { displays: 1 }
): DesktopObservation {
  if (jpeg.length === 0) throw new Error('Electron a produit une capture desktop vide')
  return {
    data: {
      width: imageSize.width,
      height: imageSize.height,
      sourceWidth: source.width,
      sourceHeight: source.height,
      originX: source.left,
      originY: source.top,
      mimeType: 'image/jpeg',
      scope,
      displays: displayInfo.displays,
      ...(displayInfo.display === undefined ? {} : { display: displayInfo.display })
    },
    attachment: {
      name: 'desktop-current.jpg',
      mimeType: 'image/jpeg',
      size: jpeg.length,
      kind: 'image',
      content: jpeg.toString('base64')
    }
  }
}

async function captureForegroundWindow(): Promise<DesktopObservation> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: MAX_WIDTH, height: MAX_HEIGHT },
    fetchWindowIcons: false
  })
  if (sources.length === 0) throw new Error('Electron ne retourne aucune fenetre capturable')
  const foreground = await windowRect().catch(() => undefined)
  const source =
    (foreground
      ? sources.find(({ id }) => id.startsWith(`window:${foreground.handle}:`))
      : undefined) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('La fenetre Windows active ne fournit aucune image')
  }
  const sourceHandle = /^window:(\d+):/.exec(source.id)?.[1]
  if (!sourceHandle) throw new Error(`Identifiant de fenetre Electron invalide: ${source.id}`)
  const geometry = foreground?.handle === sourceHandle ? foreground : await windowRect(sourceHandle)
  const ratio = Math.min(1, MAX_WIDTH / geometry.width, MAX_HEIGHT / geometry.height)
  const image = source.thumbnail.resize({
    width: Math.max(1, Math.round(geometry.width * ratio)),
    height: Math.max(1, Math.round(geometry.height * ratio)),
    quality: 'best'
  })
  if (!hasVisiblePixels(image.toBitmap())) {
    throw new Error('Capture de la fenetre active noire ou protegee')
  }
  return observation(image.toJPEG(JPEG_QUALITY), image.getSize(), geometry, 'foreground-window')
}

function virtualBounds(displays: readonly PhysicalDisplayLayout[]): Rect {
  const left = Math.min(...displays.map((display) => display.left))
  const top = Math.min(...displays.map((display) => display.top))
  const right = Math.max(...displays.map((display) => display.left + display.width))
  const bottom = Math.max(...displays.map((display) => display.top + display.height))
  return { left, top, width: right - left, height: bottom - top }
}

function sourceForDisplay(
  sources: readonly DesktopCapturerSource[],
  display: Display,
  index: number
): DesktopCapturerSource | undefined {
  return sources.find(({ display_id }) => display_id === String(display.id)) ?? sources[index]
}

export interface DisplayEntry {
  layout: PhysicalDisplayLayout
  /** Index d'origine dans screen.getAllDisplays(), requis pour retrouver la source Electron. */
  sourceIndex: number
}

/**
 * Ordonne les moniteurs de gauche a droite (puis de haut en bas) et retient celui demande.
 * `display` est un rang 1-base dans cet ordre visuel ; absent, tous les moniteurs sont gardes.
 */
export function selectDisplayEntries(
  entries: readonly DisplayEntry[],
  display?: number
): DisplayEntry[] {
  const ordered = [...entries].sort(
    (a, b) => a.layout.left - b.layout.left || a.layout.top - b.layout.top
  )
  if (display === undefined) return ordered
  if (!Number.isInteger(display) || display < 1 || display > ordered.length) {
    throw new Error(`Ecran ${display} inexistant : ${ordered.length} moniteur(s) detecte(s)`)
  }
  return [ordered[display - 1]]
}

/** Capture tous les moniteurs (ou un seul, plein cadre), avec repli sur la fenetre active sous RDP. */
export async function captureElectronDesktop(
  options: { forceForegroundWindow?: boolean; display?: number } = {}
): Promise<DesktopObservation> {
  const allDisplays = screen.getAllDisplays()
  if (allDisplays.length === 0) throw new Error('Aucun ecran Windows disponible')
  const allLayouts = allDisplays.map((display) =>
    physicalDisplayLayout(
      display,
      screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y })
    )
  )
  const selected = selectDisplayEntries(
    allLayouts.map((layout, sourceIndex) => ({ layout, sourceIndex })),
    options.display
  )
  const layouts = selected.map(({ layout }) => layout)
  const virtual = virtualBounds(layouts)
  if (virtual.width <= 0 || virtual.height <= 0) throw new Error('Geometrie desktop invalide')
  const ratio = Math.min(1, MAX_WIDTH / virtual.width, MAX_HEIGHT / virtual.height)
  const width = Math.max(1, Math.round(virtual.width * ratio))
  const height = Math.max(1, Math.round(virtual.height * ratio))
  let sources: DesktopCapturerSource[] = []
  if (!options.forceForegroundWindow) {
    for (let attempt = 0; attempt < CAPTURE_ATTEMPTS && sources.length === 0; attempt += 1) {
      sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: MAX_WIDTH, height: MAX_HEIGHT },
        fetchWindowIcons: false
      })
      if (sources.length === 0 && attempt + 1 < CAPTURE_ATTEMPTS) await delay(150)
    }
  }
  if (sources.length === 0) return await captureForegroundWindow()

  const bitmap = Buffer.alloc(width * height * 4)
  let copiedDisplays = 0
  let visibleSample = false
  selected.forEach(({ layout, sourceIndex }) => {
    const display = allDisplays[sourceIndex]
    const source = display ? sourceForDisplay(sources, display, sourceIndex) : undefined
    if (!layout || !source || source.thumbnail.isEmpty()) return
    const targetWidth = Math.max(1, Math.round(layout.width * ratio))
    const targetHeight = Math.max(1, Math.round(layout.height * ratio))
    const resized = source.thumbnail.resize({
      width: targetWidth,
      height: targetHeight,
      quality: 'best'
    })
    const pixels = resized.toBitmap()
    if (pixels.length < targetWidth * targetHeight * 4) return
    const offsetX = Math.round((layout.left - virtual.left) * ratio)
    const offsetY = Math.round((layout.top - virtual.top) * ratio)
    const copyWidth = Math.max(0, Math.min(targetWidth, width - offsetX))
    for (let row = 0; row < targetHeight && offsetY + row < height; row += 1) {
      const sourceStart = row * targetWidth * 4
      const targetStart = ((offsetY + row) * width + offsetX) * 4
      pixels.copy(bitmap, targetStart, sourceStart, sourceStart + copyWidth * 4)
    }
    if (hasVisiblePixels(pixels)) visibleSample = true
    copiedDisplays += 1
  })
  if (copiedDisplays === 0 || !visibleSample) {
    return await captureForegroundWindow()
  }

  const jpeg = nativeImage
    .createFromBitmap(bitmap, { width, height, scaleFactor: 1 })
    .toJPEG(JPEG_QUALITY)
  return observation(jpeg, { width, height }, virtual, 'desktop', {
    displays: allDisplays.length,
    display: options.display
  })
}
