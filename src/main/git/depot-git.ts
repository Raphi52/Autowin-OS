import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Le dossier est-il DANS un dépôt git — à sa racine OU dans un sous-dossier ?
 *
 * Remonte les parents jusqu'à trouver un `.git` (dossier d'un dépôt classique, ou FICHIER d'une
 * copie de travail isolée). Lecture disque pure, sans lancer git : un `execFileSync` dans le
 * process principal fige la fenêtre (mesuré à 11 720 ms le 2026-09-08, voir index.ts).
 */
export function estDansUnDepotGit(dossier: string): boolean {
  let courant = resolve(dossier)
  for (;;) {
    if (existsSync(join(courant, '.git'))) return true
    const parent = dirname(courant)
    if (parent === courant) return false
    courant = parent
  }
}

const SHA = /^[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/

function lire(chemin: string): string | undefined {
  try {
    return readFileSync(chemin, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Sha de HEAD lu sur disque, sans lancer git — même raison que `estDansUnDepotGit`
 * (`git rev-parse HEAD` synchrone dans le process principal apparaît dans gels.jsonl).
 * Gère : `.git` dossier ou fichier (`gitdir:`), HEAD détaché, référence en fichier ou groupée
 * (`packed-refs`), dossier commun d'une copie liée (`commondir`). Rend '' si illisible.
 */
export function shaHeadSurDisque(dossier: string): string {
  let courant = resolve(dossier)
  let gitDir: string | undefined
  for (;;) {
    const candidat = join(courant, '.git')
    if (existsSync(candidat)) {
      try {
        if (statSync(candidat).isDirectory()) gitDir = candidat
        else {
          const m = /^gitdir:\s*(.+)$/m.exec(lire(candidat) ?? '')
          if (m) gitDir = resolve(courant, m[1].trim())
        }
      } catch {
        /* illisible : pas de sha */
      }
      break
    }
    const parent = dirname(courant)
    if (parent === courant) break
    courant = parent
  }
  if (!gitDir) return ''
  const head = (lire(join(gitDir, 'HEAD')) ?? '').trim()
  if (SHA.test(head)) return head
  const ref = /^ref:\s*(\S+)$/.exec(head)?.[1]
  if (!ref) return ''
  const commun = lire(join(gitDir, 'commondir'))?.trim()
  const dirs = [gitDir, ...(commun ? [resolve(gitDir, commun)] : [])]
  for (const d of dirs) {
    const v = (lire(join(d, ref)) ?? '').trim()
    if (SHA.test(v)) return v
  }
  for (const d of dirs) {
    for (const ligne of (lire(join(d, 'packed-refs')) ?? '').split(/\r?\n/)) {
      const [sha, nom] = ligne.trim().split(/\s+/)
      if (nom === ref && SHA.test(sha ?? '')) return sha
    }
  }
  return ''
}
