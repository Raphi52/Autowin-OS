import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { TrustedLearningOracle } from './types'

interface PackageShape {
  autowin?: { learningOracles?: unknown }
}

function safeCoveragePattern(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 240 &&
    !isAbsolute(value) &&
    !value.replace(/\\/gu, '/').split('/').includes('..')
  )
}

function safeAttestedFile(value: unknown): value is string {
  return safeCoveragePattern(value) && !value.includes('*')
}

/** Charge une déclaration opérateur présente AVANT l'exécution du modèle. */
export function loadTrustedLearningOracles(cwd: string): TrustedLearningOracle[] {
  try {
    const rawPackage = readFileSync(join(cwd, 'package.json'), 'utf8')
    const configured = (JSON.parse(rawPackage) as PackageShape).autowin?.learningOracles
    if (!Array.isArray(configured)) return []
    return configured.slice(0, 16).flatMap((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const record = value as Record<string, unknown>
      const command =
        typeof record.command === 'string' ? record.command.replace(/\s+/gu, ' ').trim() : ''
      const covers = Array.isArray(record.covers)
        ? [
            ...new Set(
              record.covers.filter(safeCoveragePattern).map((item) => item.replace(/\\/gu, '/'))
            )
          ].slice(0, 32)
        : []
      const attestedPaths = Array.isArray(record.attests)
        ? [
            ...new Set(
              record.attests.filter(safeAttestedFile).map((item) => item.replace(/\\/gu, '/'))
            )
          ].slice(0, 64)
        : []
      if (!command || command.length > 500 || covers.length === 0 || attestedPaths.length === 0)
        return []
      let attestedFiles: Array<{ path: string; sha256: string }>
      try {
        attestedFiles = attestedPaths.map((path) => ({
          path,
          sha256: createHash('sha256')
            .update(readFileSync(join(cwd, path)))
            .digest('hex')
        }))
      } catch {
        return []
      }
      const attestation = createHash('sha256')
        .update(JSON.stringify({ index, command, covers, attestedFiles }))
        .digest('hex')
      return [{ command, covers, attestedFiles: attestedPaths, attestation }]
    })
  } catch {
    return []
  }
}
