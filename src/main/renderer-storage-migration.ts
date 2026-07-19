import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, session } from 'electron'
import { AUTOWIN_STORAGE_SUFFIXES, legacyStorageKey } from '../shared/app-identity'

export type MigratedRendererStorage = Partial<
  Record<(typeof AUTOWIN_STORAGE_SUFFIXES)[number], string>
>

export interface LegacyRendererStorageRead {
  values: MigratedRendererStorage
  status: 'not-found' | 'read' | 'failed'
  stage?: 'open-session' | 'load-renderer' | 'read-keys'
  errorCode?: string
}

const MARKER_NAME = 'renderer-storage-migration.v1.done'
const MARKER_CONTENT = 'autowin-renderer-storage-migration:v1\n'

export function rendererStorageMigrationMarker(canonicalRoot: string): string {
  return join(canonicalRoot, MARKER_NAME)
}

export function isRendererStorageMigrationComplete(canonicalRoot: string): boolean {
  try {
    return readFileSync(rendererStorageMigrationMarker(canonicalRoot), 'utf8') === MARKER_CONTENT
  } catch {
    return false
  }
}

export function markRendererStorageMigrationComplete(canonicalRoot: string): void {
  if (isRendererStorageMigrationComplete(canonicalRoot)) return
  const marker = rendererStorageMigrationMarker(canonicalRoot)
  const temporary = `${marker}.${process.pid}-${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, MARKER_CONTENT, {
      encoding: 'utf8',
      flag: 'wx',
      flush: true
    })
    renameSync(temporary, marker)
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true })
  }
}

interface RendererLocation {
  devRendererUrl?: string
  rendererHtmlPath: string
}

async function loadRenderer(
  window: BrowserWindow,
  location: RendererLocation,
  hash?: string
): Promise<void> {
  if (location.devRendererUrl) {
    const url = new URL(location.devRendererUrl)
    url.hash = hash ?? ''
    await window.loadURL(url.toString())
  } else {
    await window.loadFile(location.rendererHtmlPath, hash ? { hash } : undefined)
  }
}

export async function readLegacyRendererStorage(
  legacyRoot: string,
  location: RendererLocation
): Promise<LegacyRendererStorageRead> {
  if (!existsSync(join(legacyRoot, 'Local Storage'))) return { values: {}, status: 'not-found' }
  let stage: NonNullable<LegacyRendererStorageRead['stage']> = 'open-session'
  let legacyWindow: BrowserWindow | undefined
  try {
    legacyWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        session: session.fromPath(legacyRoot, { cache: false }),
        contextIsolation: true,
        sandbox: true
      }
    })
    stage = 'load-renderer'
    await loadRenderer(legacyWindow, location, 'storage-migration')
    stage = 'read-keys'
    const keys = AUTOWIN_STORAGE_SUFFIXES.map((suffix) => [suffix, legacyStorageKey(suffix)])
    const expression = `(() => {
      const result = {}
      for (const [suffix, key] of ${JSON.stringify(keys)}) {
        const value = localStorage.getItem(key)
        if (value !== null) result[suffix] = value
      }
      return result
    })()`
    return {
      values: (await legacyWindow.webContents.executeJavaScript(
        expression,
        true
      )) as MigratedRendererStorage,
      status: 'read'
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return {
      values: {},
      status: 'failed',
      stage,
      errorCode: typeof code === 'string' && /^[A-Z0-9_-]{1,32}$/.test(code) ? code : 'UNKNOWN'
    }
  } finally {
    legacyWindow?.destroy()
  }
}
