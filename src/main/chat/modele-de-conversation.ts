/**
 * LE MODÈLE D'UN TOUR DE CHAT, quand la conversation a choisi le sien.
 *
 * Demande du 2026-10-11 (conv-239) : le modèle est propre à chaque conversation. Le fil peut
 * mémoriser un modèle (`Conversation.modeleChoisi`) ; à défaut, le tour part sur le rôle
 * orchestrateur de l'application, comme avant.
 *
 * Le choix est validé quand il est posé, mais le catalogue de modèles BOUGE : un modèle retiré ou
 * un fournisseur déconnecté après coup ferait échouer le tour au premier appel, sans dire pourquoi.
 * On le revalide donc au départ du tour. Un choix devenu indisponible n'est PAS avalé : l'appelant
 * reçoit le motif et l'écrit dans le fil avant de partir sur le modèle par défaut.
 */
import type { ImportedModel } from '../models'
import type { ReasoningEffort, RoleBinding } from '../roles'
import { assertRuntimeBindingAvailable } from '../runtime-topology'
import type { ModeleDeConversation } from '../store/conversations'

export type ModeleDuTour =
  /** Aucun choix propre : le tour suit le modèle par défaut de l'application. */
  | { kind: 'defaut' }
  /** Le choix du fil est disponible : c'est lui qui part. */
  | { kind: 'choisi'; binding: RoleBinding }
  /** Le choix du fil n'est plus servi par le catalogue : motif à dire, repli sur le défaut. */
  | { kind: 'indisponible'; motif: string; voulu: ModeleDeConversation }

/** Convertit le choix mémorisé en binding de rôle, sans rien inventer. */
export function bindingDeModele(modele: ModeleDeConversation): RoleBinding {
  return {
    provider: modele.provider,
    ...(modele.model ? { model: modele.model } : {}),
    ...(modele.reasoningEffort
      ? { reasoningEffort: modele.reasoningEffort as ReasoningEffort }
      : {})
  }
}

/** Valide un choix contre le catalogue courant. Jette avec un motif lisible s'il est inconnu. */
export function validerModeleDeConversation(
  modele: ModeleDeConversation,
  models: ImportedModel[]
): RoleBinding {
  const binding = bindingDeModele(modele)
  assertRuntimeBindingAvailable(binding, models)
  return binding
}

export function modeleDuTour(
  choisi: ModeleDeConversation | undefined,
  models: ImportedModel[]
): ModeleDuTour {
  if (!choisi?.provider) return { kind: 'defaut' }
  try {
    return { kind: 'choisi', binding: validerModeleDeConversation(choisi, models) }
  } catch (error) {
    return {
      kind: 'indisponible',
      motif: error instanceof Error ? error.message : String(error),
      voulu: choisi
    }
  }
}
