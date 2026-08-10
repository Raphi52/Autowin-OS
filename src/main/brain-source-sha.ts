/**
 * SHA COURANT d'un chemin de dépôt — de quoi dire « cette fiche cite un commit dépassé ».
 *
 * Les locators `git:<chemin>@<sha>` de `brain-remember.ts` ancrent un fait à un commit précis. Sans
 * comparaison, l'âge d'une fiche ne dit rien : une fiche de six mois sur un fichier jamais retouché
 * reste juste, une fiche d'hier sur un fichier réécrit ce matin est périmée. On résout donc le sha du
 * DERNIER commit touchant ce fichier, dans le workspace qui le contient.
 *
 * Bornage : un seul `git log -1` par chemin, mémoïsé, timeout court, et tout échec devient `undefined`
 * (le signal s'affiche alors « non vérifié », jamais « à jour » par défaut).
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type ShaExec = (workspace: string, path: string) => string | undefined

/** Exécution réelle : `git log -1 --format=%H -- <path>`, en lecture seule. */
export function gitLogShaExec(): ShaExec {
  return (workspace, path) => {
    try {
      const out = execFileSync('git', ['log', '-1', '--format=%H', '--', path], {
        cwd: workspace,
        encoding: 'utf8',
        timeout: 3_000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      return out.trim() || undefined
    } catch {
      return undefined
    }
  }
}

/**
 * Construit le résolveur passé à `listInboxCandidates`. Mémoïsé pour la durée de l'appel : une revue
 * de boîte de réception ne doit pas lancer cent processus git.
 */
export function createHeadShaResolver(
  workspaces: readonly string[],
  exec: ShaExec = gitLogShaExec()
): (path: string) => string | undefined {
  const cache = new Map<string, string | undefined>()
  return (path: string) => {
    const clean = path.trim().replace(/\\/g, '/')
    // Un chemin vide, absolu ou remontant sort du contrat `git:<chemin de dépôt>` : on ne devine pas.
    if (!clean || clean.startsWith('/') || clean.includes('..') || /^[A-Za-z]:/.test(clean)) {
      return undefined
    }
    if (cache.has(clean)) return cache.get(clean)
    let resolved: string | undefined
    for (const workspace of workspaces) {
      if (!existsSync(join(workspace, clean))) continue
      resolved = exec(workspace, clean)
      if (resolved) break
    }
    cache.set(clean, resolved)
    return resolved
  }
}
