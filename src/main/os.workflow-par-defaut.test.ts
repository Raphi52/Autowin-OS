import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRunOverride } from './orchestrator'

/**
 * LE WORKFLOW ACTIF DE LA VUE N'EST PLUS QU'UNE VALEUR PAR DÉFAUT (conv-1070, 2026-10-22).
 *
 * Avant, `poseConversationWorkflow` rendait le workflow actif AVANT tout le reste : tant qu'un
 * workflow était actif (« Correctif » ici), le choix automatique ne tournait jamais. Mesuré le
 * 2026-10-22 : 39 démarrages sur 39 en source `manuel` dans `causal-trace/`, aucun `modele`.
 * Choix de l'utilisateur : le choix automatique passe avant lui ; le workflow actif ne sert que
 * quand rien d'autre ne propose de workflow. Un refus explicite sur la conversation reste un refus.
 */
const selections = vi.hoisted(() => ({ byConversation: {} as Record<string, string> }))
vi.mock('./role-store', () => ({ loadRoleBindings: () => undefined, saveRoleBindings: vi.fn() }))
vi.mock('./workflow-profiles', async (original) => ({
  ...(await original<typeof import('./workflow-profiles')>()),
  loadWorkflowProfiles: () => ({ profiles: [] })
}))
vi.mock('./workflow-selection', async (original) => ({
  ...(await original<typeof import('./workflow-selection')>()),
  loadWorkflowSelections: () => selections
}))

const { AutowinOS } = await import('./os')

const TACHE =
  'Implémente le thème actuel dans toutes les vues, avec un test qui vérifie les couleurs.'
const CONV = 'conv-test'
/** Ce que `appliquerWorkflowActif` (index.ts) pose pour le workflow activé dans la vue. */
const ACTIF: WorkflowRunOverride = {
  explicit: true,
  identity: { name: 'Correctif', source: 'manuel' },
  instructionFor: () => undefined
}
const CHOIX_DU_MODELE: WorkflowRunOverride = {
  identity: { name: 'Feature', source: 'modele' },
  instructionFor: () => undefined
}

type Os = {
  setActiveWorkflow: (workflow: WorkflowRunOverride | undefined) => void
  poseConversationWorkflow: (
    conversationId?: string,
    task?: string
  ) => Promise<WorkflowRunOverride | undefined>
}
const proto = AutowinOS.prototype as unknown as Os

/** Un faux `this` : le workflow actif posé par le VRAI `setActiveWorkflow`, le modèle simulé. */
function os(actif: WorkflowRunOverride | undefined, proposition: WorkflowRunOverride | undefined) {
  const poseWorkflowDynamique = vi.fn(async () => proposition)
  const fake = { poseWorkflowDynamique } as unknown as Record<string, unknown>
  proto.setActiveWorkflow.call(fake, actif)
  const pose = (): Promise<WorkflowRunOverride | undefined> =>
    proto.poseConversationWorkflow.call(fake, CONV, TACHE)
  return { pose, poseWorkflowDynamique }
}

describe('workflow actif = valeur par défaut, le choix automatique passe avant', () => {
  beforeEach(() => {
    selections.byConversation = {}
  })

  it('le choix du modèle pilote le run même quand un workflow est actif', async () => {
    const { pose, poseWorkflowDynamique } = os(ACTIF, CHOIX_DU_MODELE)
    await expect(pose()).resolves.toBe(CHOIX_DU_MODELE)
    expect(poseWorkflowDynamique).toHaveBeenCalledWith(TACHE)
  })

  it('le workflow actif reprend la main quand le modèle ne propose rien', async () => {
    const { pose } = os(ACTIF, undefined)
    await expect(pose()).resolves.toBe(ACTIF)
  })

  it('sans workflow actif ni proposition, aucun workflow', async () => {
    const { pose } = os(undefined, undefined)
    await expect(pose()).resolves.toBeUndefined()
  })

  it('un refus explicite sur la conversation gagne aussi sur le workflow actif', async () => {
    // `__aucun__` : le marqueur de refus de `workflow-selection.ts` (AUCUN_WORKFLOW, non exporté).
    selections.byConversation = { [CONV]: '__aucun__' }
    const { pose, poseWorkflowDynamique } = os(ACTIF, CHOIX_DU_MODELE)
    await expect(pose()).resolves.toBeUndefined()
    expect(poseWorkflowDynamique).not.toHaveBeenCalled()
  })
})
