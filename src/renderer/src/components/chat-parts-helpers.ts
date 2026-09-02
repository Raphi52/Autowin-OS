/**
 * HELPERS PURS du fil, ISOLES des composants.
 *
 * Un fichier de composants qui exporte AUSSI des fonctions casse le rafraichissement a chaud :
 * `vite-plugin-react` refuse le module (« Could not Fast Refresh ») et invalide son PARENT — tout
 * l'arbre React est remonte et l'etat local perdu (mesure du 2026-09-02, journal du serveur de
 * dev). Les `eslint-disable react-refresh/only-export-components` qui vivaient a cote de chaque
 * fonction faisaient taire l'avertissement sans regler le defaut.
 */
import type { ChatActionPart } from './chat-view-model'

/**
 * PASTILLE D'ICONE PAR FAMILLE D'OUTIL (design converge). Le lisere porte le STATUT, l'icone porte
 * la NATURE : sans elle, « edit_file · verify » se lit comme deux libelles interchangeables. Un
 * outil inconnu recoit le point neutre — jamais l'icone d'une famille voisine, qui mentirait.
 */
const ICONE_FAMILLE: Record<string, string> = {
  navigate: '🧭',
  chat_send: '💬',
  orchestrate: '🎯',
  create_conversation: '💬',
  rename_conversation: '💬',
  remove_conversation: '💬',
  set_role: '🎯',
  resolve_decision: '⚖️',
  load_graph: '🗺️',
  get_state: '👁️',
  edit_file: '🔧',
  write_file: '🔧',
  read_file: '👁️',
  verify: '🧪',
  remember: '🧠',
  brain_query: '🔍',
  search: '🔍'
}

/** Icone de la famille d'un outil ; '•' (neutre) si la famille est inconnue. */
export function iconeFamille(name: string): string {
  return ICONE_FAMILLE[name] ?? '•'
}

/**
 * L4 : la RAISON du lien entre deux actions consecutives. `PersistedChatActionPart` ne porte pas de
 * `parentActionId` — on ne l'invente pas : la raison se DEDUIT de (verdict precedent -> outil
 * suivant), et sans regle applicable AUCUNE etiquette n'est posee (une etiquette constante
 * fabriquerait une causalite inexistante).
 */
export function raisonDuLien(
  prev: ChatActionPart | undefined,
  current: ChatActionPart
): string | undefined {
  if (!prev) return undefined
  if (prev.ok === false) {
    return prev.name === current.name ? '2ᵉ TENTATIVE' : 'REPRISE APRÈS ÉCHEC'
  }
  if (prev.ok === true && (current.name === 'verify' || current.name === 'judge')) {
    return 'VÉRIFICATION'
  }
  return undefined
}

/**
 * CIBLE d'une action, lue dans ses arguments. Sans elle, deux `edit_file` consecutifs rendent deux
 * lignes IDENTIQUES : l'utilisateur voit qu'il se passe quelque chose sans savoir SUR QUOI — grief
 * exact de conv-1536 (« on sait pas ce que le model est en train de faire au premier coup d'oeil »).
 * Aucun champ connu -> `undefined` : on prefere le seul libelle d'outil a une cible inventee.
 */
const CLES_CIBLE = [
  'path',
  'file',
  'filePath',
  'target',
  'query',
  'command',
  'task',
  'view',
  'title',
  'name',
  'text'
] as const

/** Une cible plus longue ne se lit plus dans une sous-ligne : on la coupe par la TETE du chemin. */
const MAX_CIBLE = 72

export function resumeCible(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  for (const cle of CLES_CIBLE) {
    const valeur = record[cle]
    if (typeof valeur !== 'string') continue
    const propre = valeur.trim().split(/\r?\n/u)[0]
    if (!propre) continue
    return propre.length > MAX_CIBLE ? `…${propre.slice(-MAX_CIBLE)}` : propre
  }
  return undefined
}

/**
 * Tâche d'une action interrompue, si on peut la retrouver. C'est elle qui permet de REPRENDRE d'un
 * clic : relancée à l'identique, elle retombe sur l'acquis persisté du run mort et repart à la phase
 * suivante — au lieu d'obliger l'utilisateur à retaper sa demande.
 */
export function interruptedTask(actions: ChatActionPart[]): string | undefined {
  for (const action of actions) {
    if (!action.interrupted) continue
    const task = (action.args as { task?: unknown } | undefined)?.task
    if (typeof task === 'string' && task.trim()) return task.trim()
  }
  return undefined
}

/**
 * Tâche d'une action ÉCHOUÉE, si on peut la retrouver — pour la RELANCER d'un clic. Distincte de
 * `interruptedTask` : un échec se re-lance (re-run), un tour interrompu se reprend (acquis persisté).
 * Sans elle, un échec n'offrait AUCUN levier : l'utilisateur voyait « erreur » sans quoi faire.
 */
export function failedTask(actions: ChatActionPart[]): string | undefined {
  for (const action of actions) {
    if (action.ok !== false) continue
    const task = (action.args as { task?: unknown } | undefined)?.task
    if (typeof task === 'string' && task.trim()) return task.trim()
  }
  return undefined
}
