import { existsSync } from 'node:fs'
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
