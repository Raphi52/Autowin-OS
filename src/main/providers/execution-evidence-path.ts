import { posix, win32 } from 'node:path'

export function executionEvidencePath(path: string, cwd?: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  const flavor = /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.includes('\\') ? win32 : posix
  if (!cwd || !flavor.isAbsolute(trimmed))
    return trimmed.replaceAll('\\', '/').replace(/^\.\/+/, '')
  const relative = flavor.relative(cwd, trimmed)
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${flavor.sep}`) ||
    flavor.isAbsolute(relative)
  ) {
    return trimmed.replaceAll('\\', '/')
  }
  return relative.replaceAll('\\', '/')
}
