import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync
} from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'

function canonicalInside(path: string, root: string): boolean {
  if (!existsSync(root)) return false
  const rel = relative(realpathSync(root), path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

function readFromHandle(path: string, byteLimit: number, allowedRoots?: string[]): Buffer {
  const noFollow = constants.O_NOFOLLOW ?? 0
  const fd = openSync(path, constants.O_RDONLY | noFollow)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('La cible Behaviour doit être un fichier')
    const finalPath = realpathSync(path)
    if (allowedRoots && !allowedRoots.some((root) => canonicalInside(finalPath, root)))
      throw new Error('La cible finale du fichier est hors des racines autorisées')
    const finalStat = statSync(finalPath)
    if (stat.dev !== finalStat.dev || stat.ino !== finalStat.ino)
      throw new Error('Le fichier Behaviour a changé pendant son ouverture')
    const buffer = Buffer.allocUnsafe(byteLimit)
    let offset = 0
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, offset)
      if (count === 0) break
      offset += count
    }
    return buffer.subarray(0, offset)
  } finally {
    closeSync(fd)
  }
}

export function readUtf8Prefix(path: string, maxBytes: number): string {
  return readFromHandle(realpathSync(path), maxBytes).toString('utf8')
}

export function readBoundedUtf8FileWithin(
  path: string,
  allowedRoots: string[],
  maxBytes: number
): string {
  const canonical = realpathSync(path)
  if (!allowedRoots.some((root) => canonicalInside(canonical, root)))
    throw new Error('Fichier hors des racines autorisées')
  const contents = readFromHandle(canonical, maxBytes + 1, allowedRoots)
  if (contents.length > maxBytes)
    throw new Error(`Fichier trop volumineux (limite ${maxBytes} octets)`)
  return contents.toString('utf8')
}
