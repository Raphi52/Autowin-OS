import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from './app-data'

/**
 * Quel workflow pilote quelle conversation.
 *
 * La sélection est PAR CONVERSATION et non globale : on veut pouvoir mener un fil en Rapide pendant
 * qu'un autre tourne en Rigoureux. Un état unique obligerait à basculer sans arrêt, et surtout il
 * changerait silencieusement le déroulé d'une conversation qu'on n'était pas en train de regarder.
 *
 * Ce module ne fait que la correspondance ; c'est délibérément un magasin bête. Traduire un profil en
 * réglages appartient à `workflow-profile-apply`, et le poser sur un run à l'appelant.
 */

export interface WorkflowSelections {
  /** conversationId → id de profil. Une entrée absente = aucun workflow imposé. */
  byConversation: Record<string, string>
}

export function workflowSelectionPath(base = ensureAutowinAppData()): string {
  return join(base, 'workflow-selection.json')
}

export function loadWorkflowSelections(path = workflowSelectionPath()): WorkflowSelections {
  if (!existsSync(path)) return { byConversation: {} }
  try {
    // Le BOM est retiré : sous Windows presque tout ce qui écrit un fichier à la main en pose un, et
    // `JSON.parse` échouerait — un réglage silencieusement perdu s'est déjà produit ici.
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
    if (!parsed || typeof parsed !== 'object') return { byConversation: {} }
    const brut = (parsed as { byConversation?: unknown }).byConversation
    if (!brut || typeof brut !== 'object') return { byConversation: {} }
    const byConversation: Record<string, string> = {}
    for (const [convId, profileId] of Object.entries(brut as Record<string, unknown>)) {
      if (typeof profileId === 'string' && profileId) byConversation[convId] = profileId
    }
    return { byConversation }
  } catch {
    return { byConversation: {} }
  }
}

/**
 * Marqueur d'un refus EXPLICITE : « je ne veux aucun workflow ici ».
 *
 * Effacer l'entrée rendait ce refus indiscernable de « jamais choisi » — et le mode dynamique
 * réimposait alors un workflow que l'utilisateur venait tout juste de retirer. Un refus doit se
 * persister comme une décision, pas s'évaporer.
 */
export const AUCUN_WORKFLOW = '__aucun__'

/** L'id choisi, `AUCUN_WORKFLOW` si l'utilisateur a refusé, `undefined` s'il ne s'est pas prononcé. */
export function workflowForConversation(
  selections: WorkflowSelections,
  conversationId: string | undefined
): string | undefined {
  if (!conversationId) return undefined
  return selections.byConversation[conversationId]
}

/** L'utilisateur a-t-il DIT « aucun » ? Distinct de « ne s'est jamais prononcé ». */
export function refusExplicite(
  selections: WorkflowSelections,
  conversationId: string | undefined
): boolean {
  return workflowForConversation(selections, conversationId) === AUCUN_WORKFLOW
}
