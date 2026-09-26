/**
 * LES DEUX SEULES ACTIONS GIT QUE L'INTERFACE PEUT DÉCLENCHER À LA SOURIS.
 *
 * Demande de l'utilisateur (2026-09-15) : glisser-déposer dans le graphe, « et que la bonne commande
 * soit appelée en fond ». Le danger de cette phrase est la commande construite PAR l'interface : un
 * nom de branche est une chaîne, et `--exec=…` est une chaîne. Ici le renderer n'envoie JAMAIS de
 * ligne de commande — il envoie un TYPE de geste et des noms, validés puis assemblés ici.
 *
 * Ce qui est dehors, et le restera tant qu'un humain ne l'aura pas demandé explicitement : `rebase`,
 * `reset`, `branch -f`, `push --force`, la suppression de branche. Toutes réécrivent ou effacent une
 * histoire, et aucune ne doit pouvoir partir d'un geste de souris — un glissé part tout seul, se
 * relâche au mauvais endroit, et ne se reprend pas.
 *
 * Les deux gestes retenus vont EN AVANT : ils ajoutent un commit, ils n'en détruisent aucun. Une
 * fusion se défait par `git revert`, un report de commit aussi.
 */

export type DemandeActionGit =
  | { type: 'merge'; source: string; cible: string }
  | { type: 'cherry-pick'; commit: string; cible: string }

export type PlanActionGit = { argv: string[][]; libelle: string }
export type RefusActionGit = { refus: string }

export type ResultatActionGit =
  { ok: true; commande: string; sortie: string } | { ok: false; raison: string }

/**
 * Un nom de branche ACCEPTABLE. Volontairement plus strict que `git check-ref-format` : ce qui passe
 * ici vient d'un clic, pas d'un terminal, et le jeu réel des branches de ce dépôt tient largement
 * dedans. Un refus se corrige ; une injection ne se rattrape pas.
 */
function nomDeBrancheValide(nom: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(nom) && !nom.includes('..') && !nom.endsWith('.lock')
  )
}

/** Une empreinte de commit, et rien d'autre : `HEAD~1` ou `--force` ne sont pas des empreintes. */
function empreinteValide(hash: string): boolean {
  return /^[0-9a-f]{7,40}$/.test(hash)
}

export function planifierActionGit(demande: DemandeActionGit): PlanActionGit | RefusActionGit {
  if (demande.type !== 'merge' && demande.type !== 'cherry-pick')
    return { refus: `Geste « ${(demande as { type: string }).type} » hors de la liste blanche.` }

  const cible = demande.cible?.trim() ?? ''
  if (!nomDeBrancheValide(cible)) return { refus: `Nom de branche invalide : « ${cible} ».` }

  if (demande.type === 'merge') {
    const source = demande.source?.trim() ?? ''
    if (!nomDeBrancheValide(source)) return { refus: `Nom de branche invalide : « ${source} ».` }
    return {
      argv: [
        ['checkout', cible],
        // `--no-ff` : la fusion reste un commit identifiable, donc annulable par un seul `revert`.
        // Une avance rapide silencieuse rendrait le geste indistinguable d'un déplacement de branche.
        ['merge', '--no-ff', source]
      ],
      libelle: `git checkout ${cible} && git merge --no-ff ${source}`
    }
  }

  const commit = demande.commit?.trim() ?? ''
  if (!empreinteValide(commit)) return { refus: `Empreinte de commit invalide : « ${commit} ».` }
  return {
    argv: [
      ['checkout', cible],
      ['cherry-pick', commit]
    ],
    libelle: `git checkout ${cible} && git cherry-pick ${commit}`
  }
}
