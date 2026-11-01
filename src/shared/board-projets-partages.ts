/**
 * LES PROJETS PARTAGÉS DU BOARD (demande utilisateur du 2026-10-28, conv-1211 : « dans le board je
 * veux qu'on puisse choisir quel CWD on partage »).
 *
 * Le dossier du Board (conv-1206, `src/main/board-dossier.ts`) recopiait TOUS les projets sur le
 * partage de l'équipe, y compris les fils perso ou d'un autre client. On choisit désormais lesquels
 * partent. Un projet du Board = un dossier de travail (ou une catégorie de la barre latérale) : sa
 * `cle` est celle de `groupeDe`, la même que la vue affiche.
 *
 * Le choix est une LISTE BLANCHE : `null` = tous les projets, y compris ceux qui apparaîtront plus
 * tard ; une liste = seulement ceux-là — un projet nouveau ne part pas sur le partage sans qu'on
 * l'ait coché. Fonctions pures, partagées par le processus principal et la vue.
 */
import type { CarteDesBesoins, StatutDemande } from './carte-des-besoins'

/** Au-delà, le choix est refusé : la barre latérale n'a jamais autant de projets. */
export const PROJETS_PARTAGES_MAX = 500

/**
 * Le choix relu du réglage du poste ou reçu de la vue (qui n'est pas une source sûre).
 * `null` = tous les projets ; `undefined` = valeur illisible, à refuser. Vides et doublons retirés.
 */
export function projetsPartagesLisibles(valeur: unknown): string[] | null | undefined {
  if (valeur === null || valeur === undefined) return null
  if (!Array.isArray(valeur) || valeur.length > PROJETS_PARTAGES_MAX) return undefined
  const vus = new Set<string>()
  for (const v of valeur) {
    if (typeof v !== 'string') return undefined
    const cle = v.trim()
    if (cle) vus.add(cle)
  }
  return [...vus]
}

/**
 * La carte réduite aux projets partagés, comptes refaits : `board.json` ne doit pas annoncer
 * 5 000 demandes quand il n'en porte que 300. `null` = la carte telle quelle.
 */
export function carteDesProjetsPartages(
  carte: CarteDesBesoins,
  projets: readonly string[] | null
): CarteDesBesoins {
  if (projets === null) return carte
  const gardes = new Set(projets)
  const retenus = carte.projets.filter((p) => gardes.has(p.cle))
  const comptes: Record<StatutDemande, number> = {
    prouve: 0,
    refuse: 0,
    'en-cours': 0,
    'sans-preuve': 0
  }
  for (const p of retenus)
    for (const statut of Object.keys(comptes) as StatutDemande[])
      comptes[statut] += p.comptes[statut]
  return {
    ...carte,
    projets: retenus,
    comptes,
    demandes: retenus.reduce((n, p) => n + p.demandes.length, 0),
    runsBloques: retenus.reduce((n, p) => n + p.runsBloques.length, 0),
    runsEnAttenteDeDecision: retenus.reduce(
      (n, p) => n + (p.runsEnAttenteDeDecision?.length ?? 0),
      0
    )
  }
}

/** Le projet est-il recopié dans le dossier ? */
export function projetPartage(projets: readonly string[] | null, cle: string): boolean {
  return projets === null || projets.includes(cle)
}

/**
 * Cocher ou décocher un projet. Décocher depuis « tous » garde tous les projets AFFICHÉS sauf
 * celui-là : la liste devient explicite, et un projet futur ne part plus sans être coché.
 */
export function basculerProjetPartage(
  projets: readonly string[] | null,
  cle: string,
  projetsAffiches: readonly string[]
): string[] {
  const actuels = projets === null ? [...projetsAffiches] : [...projets]
  return actuels.includes(cle) ? actuels.filter((c) => c !== cle) : [...actuels, cle]
}

/** Combien des projets affichés partent : « tous », ou n sur le total affiché. */
export function resumeDesProjetsPartages(
  projets: readonly string[] | null,
  projetsAffiches: readonly string[]
): { tous: true } | { tous: false; partages: number; total: number } {
  if (projets === null) return { tous: true }
  return {
    tous: false,
    partages: projetsAffiches.filter((c) => projets.includes(c)).length,
    total: projetsAffiches.length
  }
}
