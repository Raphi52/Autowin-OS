/**
 * LES CANAUX DES RÔLES D'AGENTS, sortis de `src/main/index.ts`.
 *
 * Canaux : lire les rôles courants, poser le fournisseur/modèle d'un rôle depuis la vue, lire et
 * poser le modèle des petites tâches, poser le modèle propre à une conversation.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, même
 * attente du catalogue de modèles avant de servir OU d'écrire. Deux règles de fond intactes :
 *   - les rôles ne sont pas une autorité à part : écrire un rôle passe par la TOPOLOGIE, qui est
 *     persistée puis resynchronisée — c'est `agent-topology.json` la source, pas `roles.json` ;
 *   - le catalogue de modèles est attendu avant de répondre, sinon un rôle non résolu sortirait.
 *
 * `agentTopology` et `agentModels` sont des variables RÉASSIGNÉES dans `index.ts` : elles sont
 * reçues comme lecteurs, jamais comme valeurs — sinon un rôle posé après un rafraîchissement du
 * catalogue serait validé contre le catalogue du démarrage.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { topologyWithRuntimeRole } from '../runtime-topology'
import type { AgentTopology } from '../topology'
import type { ImportedModel } from '../models'
import type { PetitesTachesEtat, Role, ReasoningEffort } from '../roles'
import type { AutowinOS } from '../os'
import { bindingDeModele, validerModeleDeConversation } from '../chat/modele-de-conversation'
import { assertRuntimeBindingAvailable } from '../runtime-topology'

/** Ce que les canaux des rôles prenaient dans `index.ts` — désormais passé explicitement. */
export type RolesIpcDeps = {
  os: AutowinOS
  /** Le catalogue de modèles : attendu avant de servir comme avant d'écrire. */
  agentModelsReady: Promise<unknown>
  /** Le catalogue courant, LU à l'instant de l'appel (il est réassigné ailleurs). */
  lireModeles: () => ImportedModel[]
  /** La topologie courante, LUE à l'instant de l'appel (elle est réassignée ailleurs). */
  lireTopologie: () => AgentTopology
  /** Persiste la topologie, resynchronise les rôles et rend celle qui a été retenue. */
  appliquerTopologie: (topology: AgentTopology) => AgentTopology
  /** Prévenir les écrans que les rôles ont changé. */
  broadcastRolesRefresh: () => void
  /** Prévenir les écrans qu'une conversation a changé (modèle propre à un fil). */
  broadcastConversationsRefresh: () => void
}

export function registerRolesIpc({
  os,
  agentModelsReady,
  lireModeles,
  lireTopologie,
  appliquerTopologie,
  broadcastRolesRefresh,
  broadcastConversationsRefresh
}: RolesIpcDeps): void {
  ipcMain.handle('os:roles', async (event) => {
    assertTrustedRendererSender(event, 'Roles')
    await agentModelsReady
    return os.roles.all()
  })
  ipcMain.handle(
    'os:setRole',
    async (event, role: Role, provider: string, model?: string, reasoningEffort?: string) => {
      assertTrustedRendererSender(event, 'SetRole')
      await agentModelsReady
      const next = topologyWithRuntimeRole(
        lireTopologie(),
        role,
        {
          provider,
          model,
          reasoningEffort: reasoningEffort as ReasoningEffort | undefined
        },
        lireModeles()
      )
      appliquerTopologie(next)
      broadcastRolesRefresh()
      return os.roles.all()
    }
  )
  /**
   * LE MODÈLE DES PETITES TÂCHES (conv-264, 2026-10-11) — choix automatique du workflow (le tri des
   * conversations qu'il servait aussi a été retiré le 2026-10-17, conv-305). Ne passe PAS par la topologie : ce n'est pas un rôle du pipeline, sa seule source
   * est la clé `petitesTaches` de `roles.json`. Validé contre le catalogue AVANT d'écrire, comme le
   * modèle d'une conversation. `provider === null` efface le réglage (retour au modèle du chat).
   */
  const etatPetitesTaches = (): PetitesTachesEtat => ({
    reglage: os.roles.getPetitesTaches() ?? null,
    effectif: os.roles.bindingDesPetitesTaches()
  })
  ipcMain.handle('os:petitesTaches', async (event) => {
    assertTrustedRendererSender(event, 'PetitesTaches')
    await agentModelsReady
    return etatPetitesTaches()
  })
  ipcMain.handle(
    'os:setPetitesTaches',
    async (event, provider: unknown, model?: unknown, reasoningEffort?: unknown) => {
      assertTrustedRendererSender(event, 'SetPetitesTaches')
      if (provider === null) {
        os.setPetitesTaches(undefined)
        broadcastRolesRefresh()
        return etatPetitesTaches()
      }
      if (typeof provider !== 'string' || !provider.trim()) throw new Error('fournisseur manquant')
      await agentModelsReady
      const binding = bindingDeModele({
        provider: provider.trim(),
        ...(typeof model === 'string' && model.trim() ? { model: model.trim() } : {}),
        ...(typeof reasoningEffort === 'string' && reasoningEffort.trim()
          ? { reasoningEffort: reasoningEffort.trim() }
          : {})
      })
      assertRuntimeBindingAvailable(binding, lireModeles())
      os.setPetitesTaches(binding)
      broadcastRolesRefresh()
      return etatPetitesTaches()
    }
  )
  /**
   * LE MODÈLE D'UNE SEULE CONVERSATION (conv-239, 2026-10-11).
   *
   * Contrairement à `os:setRole`, ne touche NI la topologie NI les autres fils : le choix est
   * mémorisé sur la conversation et appliqué au départ de chacun de ses tours (index.ts,
   * `modeleDuTour`). `provider === null` efface le choix : le fil revient au modèle par défaut.
   * Validé contre le catalogue AVANT d'écrire — un modèle inconnu est refusé ici, pas au tour.
   * Rend le choix retenu, ou null (aucun choix propre / id inconnu).
   */
  ipcMain.handle(
    'os:conversations:setModel',
    async (
      event,
      rawId: unknown,
      provider: unknown,
      model?: unknown,
      reasoningEffort?: unknown
    ) => {
      assertTrustedRendererSender(event, 'SetConversationModel')
      if (typeof rawId !== 'string' || !rawId.trim()) throw new Error('id de conversation manquant')
      if (provider === null) {
        const effacee = os.conversations.choisirModele(rawId, null)
        if (effacee) broadcastConversationsRefresh()
        return null
      }
      if (typeof provider !== 'string' || !provider.trim()) throw new Error('fournisseur manquant')
      await agentModelsReady
      const binding = validerModeleDeConversation(
        {
          provider,
          ...(typeof model === 'string' && model.trim() ? { model } : {}),
          ...(typeof reasoningEffort === 'string' && reasoningEffort.trim()
            ? { reasoningEffort }
            : {})
        },
        lireModeles()
      )
      const retenue = os.conversations.choisirModele(rawId, binding)
      if (!retenue) return null
      broadcastConversationsRefresh()
      return retenue.modeleChoisi ?? null
    }
  )
}
