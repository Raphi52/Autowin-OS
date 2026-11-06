import { createHash } from 'node:crypto'

/** Empreinte exacte et non reversible : aucun contenu brut n'est transporte ni persiste. */
export function exactLineFingerprint(line: string): string {
  return createHash('sha256').update(line, 'utf8').digest('hex')
}

/** Empreintes du multiensemble de lignes ajoutees, ordre et doublons conserves. */
export function addedLineFingerprints(
  before: string,
  after: string,
  limit = Number.POSITIVE_INFINITY
): string[] {
  const remaining = new Map<string, number>()
  for (const line of before.split(/\r?\n/).filter(Boolean)) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1)
  }
  const added: string[] = []
  for (const line of after.split(/\r?\n/).filter(Boolean)) {
    const count = remaining.get(line) ?? 0
    if (count > 0) {
      if (count === 1) remaining.delete(line)
      else remaining.set(line, count - 1)
      continue
    }
    added.push(exactLineFingerprint(line))
    if (added.length >= limit) break
  }
  return added
}

/** Empreintes des ajouts d'un diff unifié, sans confondre `+++` contenu avec l'en-tête fichier. */
export function addedLineFingerprintsFromUnifiedDiff(
  diff: string,
  limit = Number.POSITIVE_INFINITY
): string[] {
  const lines = diff.split(/\r?\n/)
  const hasHunks = lines.some((line) => line.startsWith('@@'))
  let inHunk = !hasHunks
  const added: string[] = []
  for (let index = 0; index < lines.length && added.length < limit; index += 1) {
    const line = lines[index]
    if (line.startsWith('diff --git ')) {
      inHunk = !hasHunks
      continue
    }
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk || !line.startsWith('+')) continue
    const isFileHeader =
      !hasHunks && line.startsWith('+++ ') && lines[index - 1]?.startsWith('--- ')
    if (!isFileHeader) added.push(exactLineFingerprint(line.slice(1)))
  }
  return added
}
