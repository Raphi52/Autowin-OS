import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

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
 * Le premier `.git` en remontant depuis `dossier` : `racine` = le dossier qui le porte, `gitDir` = le
 * dossier git qu'il désigne (lui-même, ou la cible du `gitdir:` d'une copie liée ; absent si
 * illisible). `undefined` hors de tout dépôt.
 */
function gitDirSurDisque(dossier: string): { racine: string; gitDir?: string } | undefined {
  let courant = resolve(dossier)
  for (;;) {
    const candidat = join(courant, '.git')
    if (existsSync(candidat)) {
      try {
        if (statSync(candidat).isDirectory()) return { racine: courant, gitDir: candidat }
        const m = /^gitdir:\s*(.+)$/m.exec(lire(candidat) ?? '')
        return { racine: courant, gitDir: m ? resolve(courant, m[1].trim()) : undefined }
      } catch {
        return { racine: courant }
      }
    }
    const parent = dirname(courant)
    if (parent === courant) return undefined
    courant = parent
  }
}

/**
 * Le dossier du dépôt PRINCIPAL qui porte `dossier`, lu sur disque sans lancer git (même raison que
 * `estDansUnDepotGit`). Pour un dépôt classique, sa racine. Pour une copie liée (`git worktree`),
 * dont le `.git` est un fichier `gitdir: <commun>/worktrees/<nom>`, le dépôt d'origine : son
 * `commondir` désigne le dossier git commun, dont le parent est le dossier principal. Une copie de
 * fil rangée SOUS le dépôt (`.autowin-data/…/essai__…`) rend donc le dépôt, pas la copie.
 * `undefined` hors de tout dépôt, ou si le `.git` est illisible.
 */
export function depotPrincipalSurDisque(dossier: string): string | undefined {
  const trouve = gitDirSurDisque(dossier)
  if (!trouve?.gitDir) return undefined
  const commun = lire(join(trouve.gitDir, 'commondir'))?.trim()
  if (!commun) return trouve.racine
  const dossierGitCommun = resolve(trouve.gitDir, commun)
  // Un dossier commun nu (sans arbre de travail) ne finit pas par `.git` : il sert lui-même d'identité.
  return basename(dossierGitCommun).toLowerCase() === '.git'
    ? dirname(dossierGitCommun)
    : dossierGitCommun
}

/**
 * Sha de HEAD lu sur disque, sans lancer git — même raison que `estDansUnDepotGit`
 * (`git rev-parse HEAD` synchrone dans le process principal apparaît dans gels.jsonl).
 * Gère : `.git` dossier ou fichier (`gitdir:`), HEAD détaché, référence en fichier ou groupée
 * (`packed-refs`), dossier commun d'une copie liée (`commondir`). Rend '' si illisible.
 */
export function shaHeadSurDisque(dossier: string): string {
  const gitDir = gitDirSurDisque(dossier)?.gitDir
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
