/**
 * Où chercher un fichier cité par un agent, et comment l'ouvrir À SA LIGNE.
 *
 * Deux défauts du lien fichier de conv-1427 vivent ici, tous deux relevés par le juge le
 * 2026-08-27 et laissés ouverts :
 *
 * - La racine était `AUTOWIN_OS_WORKSPACE ?? process.cwd()`. Or un agent cite ce qu'il voit depuis
 *   SA copie (`worktrees/<hash>/agent__run-*`). Un fichier créé pendant le run n'existe pas encore
 *   dans le workspace : le clic répondait `introuvable`, soit exactement la plainte d'origine.
 * - Le numéro de ligne était parsé, transporté, puis jeté. Le lien ouvrait le fichier et jamais la
 *   ligne, sans jamais le dire.
 *
 * Module PUR (aucune I/O, le listage est injecté) : le handler IPC reste mince et ces deux règles
 * sont testables sans monter de dépôt git.
 */

/** Copies où un agent a pu écrire ce qu'il cite. Le workspace d'abord : c'est le cas normal. */
export function racinesRevelation(opts: {
  workspace: string
  worktreesRoot: string | undefined
  lister: (dir: string) => string[]
}): string[] {
  const racines = [opts.workspace]
  if (!opts.worktreesRoot) return racines
  for (const repo of opts.lister(opts.worktreesRoot)) {
    if (repo.startsWith('.')) continue
    const dossierRepo = `${opts.worktreesRoot}/${repo}`
    for (const copie of opts.lister(dossierRepo)) {
      // Seules les copies d'AGENT portent du travail à révéler. Une copie `integration__` est
      // éphémère et appartient à la publication ; `.quarantine` n'est pas un lieu de lecture.
      if (!copie.startsWith('agent__')) continue
      racines.push(`${dossierRepo}/${copie}`)
    }
  }
  return racines
}

/**
 * Commande d'ouverture à la ligne, ou `null` s'il n'y en a pas.
 *
 * `null` n'est PAS un échec silencieux : l'appelant doit alors ouvrir le fichier normalement ET
 * dire que la ligne n'a pas été honorée. Le défaut d'origine n'était pas de ne pas savoir ouvrir à
 * la ligne — c'était de promettre `a.ts:80` en le taisant.
 *
 * Le gabarit vient de la configuration (`AUTOWIN_OS_EDITOR`), jamais du renderer : on n'exécute
 * que ce que l'utilisateur de cette machine a écrit lui-même.
 */
export function commandeEditeur(opts: {
  editeur: string | undefined
  chemin: string
  ligne: number | undefined
}): { commande: string; args: string[] } | null {
  if (opts.ligne === undefined) return null
  const gabarit = (opts.editeur ?? '').trim()
  // Sans `{file}`, le gabarit ouvrirait autre chose que la cible : mieux vaut ne rien lancer.
  if (!gabarit || !gabarit.includes('{file}')) return null
  const morceaux = gabarit
    .split(/\s+/)
    .map((m) => m.replace(/\{file\}/g, opts.chemin).replace(/\{line\}/g, String(opts.ligne)))
  const [commande, ...args] = morceaux
  return commande ? { commande, args } : null
}
