/**
 * LE BOARD NE MONTRE QUE LES DOSSIERS DE TRAVAIL DU CHAT (demande utilisateur du 2026-10-28,
 * conv-1212 : « ça doit vraiment être uniquement mes CWD de la partie chat, et quand je les supprime
 * ça doit aussi les supprimer là-bas »).
 *
 * Avant : un projet du Board était tout groupe de `groupeDe` portant une demande ou un run bloqué.
 * Deux intrus s'y montraient : « depot », un dossier de mesure oublié (`D:\mesure-skills\depot`,
 * conv-1036), et « Divers », les runs bloqués dont le fil n'existe plus.
 *
 * Désormais un projet du Board est un dossier de la liste du Chat — celle du menu « Ranger dans… »,
 * avec sa croix (`autowin.conv-folders.connus`) —, plus les dossiers que le Chat propose toujours :
 * le dépôt par défaut et « This computer ». Catégories, Auto-kaizen et Divers sortent.
 * Ces deux-là se retirent aussi depuis le Board (même jour : « des éléments que je ne peux même pas
 * supprimer, ils n'ont pas la petite croix ») : la croix les range dans la mémoire des retraits
 * (`autowin.conv-folders.retires`), et ils quittent le Board comme le menu du Chat.
 * La règle est appliquée par le processus principal AVANT l'affichage ET avant la copie vers le
 * dossier du Board : ce qui part sur le partage est ce que la vue montre.
 */
import type { CarteDesBesoins } from './carte-des-besoins'
import { carteDesProjetsPartages } from './board-projets-partages'
import { canonicalProjectPath, estCheminDeDossier } from './project-path'

/** Au-delà, la liste est refusée : la barre latérale n'a jamais autant de dossiers. */
export const DOSSIERS_DU_CHAT_MAX = 500

/** La clé de comparaison d'un dossier : `d:/x/`, `D:\x` et `D:\X` sont le même dossier Windows. */
export function cleDeDossier(chemin: string | null | undefined): string | undefined {
  return canonicalProjectPath(chemin)?.toLowerCase()
}

/**
 * La liste reçue de la vue (qui n'est pas une source sûre) ou relue du poste : chemins de dossier
 * seuls, sous leur forme canonique, sans doublon. `undefined` = valeur illisible, à refuser.
 */
export function dossiersDuChatLisibles(valeur: unknown): string[] | undefined {
  if (!Array.isArray(valeur) || valeur.length > DOSSIERS_DU_CHAT_MAX) return undefined
  const vus = new Map<string, string>()
  for (const brut of valeur) {
    if (typeof brut !== 'string') return undefined
    if (!estCheminDeDossier(brut)) continue
    const canon = canonicalProjectPath(brut)
    const cle = canon?.toLowerCase()
    if (canon && cle && !vus.has(cle)) vus.set(cle, canon)
  }
  return [...vus.values()]
}

/**
 * La carte réduite aux projets qui sont un dossier du Chat, comptes refaits. `null` = la liste du
 * Chat n'a encore jamais été reçue sur ce poste : la carte telle quelle, plutôt qu'un Board vide.
 */
export function carteDesDossiersDuChat(
  carte: CarteDesBesoins,
  dossiers: readonly string[] | null
): CarteDesBesoins {
  if (dossiers === null) return carte
  const gardes = new Set(dossiers.map(cleDeDossier).filter((c): c is string => !!c))
  const retenus = carte.projets
    .filter((p) => p.nature === 'dossier' && gardes.has(cleDeDossier(p.cle) ?? ''))
    .map((p) => p.cle)
  return carteDesProjetsPartages(carte, retenus)
}

/**
 * Les dossiers que le Board montre : ceux du Chat, plus ceux qu'il propose toujours (dépôt par
 * défaut, « This computer »), sauf ceux-là quand une croix les a retirés. Les dossiers du Chat ne
 * sont pas filtrés par les retraits : le Chat les affiche tels quels, et le Board suit le Chat.
 */
export function dossiersDuBoard(
  dossiers: readonly string[],
  toujoursProposes: readonly (string | null | undefined)[],
  retires: readonly string[]
): string[] {
  const exclus = new Set(retires.map(cleDeDossier).filter((c): c is string => !!c))
  const proposes = toujoursProposes.filter(
    (chemin): chemin is string =>
      estCheminDeDossier(chemin) && !exclus.has(cleDeDossier(chemin) ?? '')
  )
  return dossiersDuChatLisibles([...dossiers, ...proposes]) ?? [...dossiers]
}
