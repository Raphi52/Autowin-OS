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
function os(
  actif: WorkflowRunOverride | undefined,
  proposition: WorkflowRunOverride | undefined,
  tache = TACHE
) {
  const poseWorkflowDynamique = vi.fn(async () => proposition)
  const fake = { poseWorkflowDynamique } as unknown as Record<string, unknown>
  proto.setActiveWorkflow.call(fake, actif)
  const pose = (): Promise<WorkflowRunOverride | undefined> =>
    proto.poseConversationWorkflow.call(fake, CONV, tache)
  return { pose, poseWorkflowDynamique }
}

/** Un symptôme nu : la cause n'est pas connue, le cadrage doit dire QUOI corriger. */
const SYMPTOME = 'quand je reviens dans ma conversation je vois plus l’historique'
/** Le graphe du « Correctif » semé (`workflow-defaults.ts`) : aucune phase `frame` ni `scout`. */
const CORRECTIF_ACTIF: WorkflowRunOverride = {
  explicit: true,
  identity: { name: 'Correctif', source: 'manuel' },
  graph: {
    entry: 'think-1',
    nodes: [
      { id: 'think-1', phase: 'think' },
      { id: 'build-1', phase: 'build' },
      { id: 'clean-1', phase: 'clean' },
      { id: 'judge-1', phase: 'judge' }
    ],
    edges: [
      { from: 'think-1', to: 'build-1', when: 'always' },
      { from: 'build-1', to: 'clean-1', when: 'always' },
      { from: 'clean-1', to: 'judge-1', when: 'always' }
    ]
  },
  instructionFor: () => undefined
}
/** Un workflow actif qui cadre déjà : rien à lui retirer. */
const FEATURE_ACTIF: WorkflowRunOverride = {
  explicit: true,
  identity: { name: 'Feature', source: 'manuel' },
  phases: ['frame', 'build', 'judge'],
  instructionFor: () => undefined
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

/**
 * LA GARDE DU CADRAGE VAUT AUSSI POUR LE WORKFLOW PAR DÉFAUT (conv-1070, 2026-10-22).
 *
 * Le choix automatique écarte un profil de réparation quand la demande est un symptôme dont la
 * cause est inconnue (`profilEcraseLeCadrage`, `workflow-dynamic.ts`) : le régime reprend la main et
 * joue le cadrage. Le workflow actif, devenu repli quand le modèle répond « aucun », passait sans
 * cette garde : « Correctif » partait encore sans cadrage sur un « je vois plus X ». Même règle,
 * même source : un graphe sans `frame` ni `scout` s'efface devant un symptôme.
 */
describe('le workflow par défaut ne saute pas le cadrage sur un symptôme', () => {
  beforeEach(() => {
    selections.byConversation = {}
  })

  it('un « Correctif » actif s’efface devant un symptôme quand le modèle ne propose rien', async () => {
    const { pose } = os(CORRECTIF_ACTIF, undefined, SYMPTOME)
    await expect(pose()).resolves.toBeUndefined()
  })

  it('le même « Correctif » pilote dès que l’utilisateur a nommé sa cible', async () => {
    const tache = 'corrige src/main/os.ts, le cache est cassé'
    const { pose } = os(CORRECTIF_ACTIF, undefined, tache)
    await expect(pose()).resolves.toBe(CORRECTIF_ACTIF)
  })

  it('un workflow actif qui cadre déjà reste le repli, même sur un symptôme', async () => {
    const { pose } = os(FEATURE_ACTIF, undefined, SYMPTOME)
    await expect(pose()).resolves.toBe(FEATURE_ACTIF)
  })
})
