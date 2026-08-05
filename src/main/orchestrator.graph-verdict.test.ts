import { describe, expect, it } from 'vitest'
import { AuthoritySas } from './authority/sas'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import type { WorkflowGraph } from './workflow-graph'

/**
 * LE VERDICT D'UN NŒUD `judge` DÉCIDE DU CHEMIN — il doit donc être un FAIT, pas une variable.
 *
 * Deux défauts distincts, mesurés sur la version committée le 2026-08-05 :
 *
 * (1) `dernierVerdict` est pré-amorcé UNE fois depuis la DERNIÈRE phase reprise (orchestrator.ts:1959)
 *     alors que la marche le relit à CHAQUE pas (:1917), et qu'une phase rejouée sort par
 *     `dejaPayee → continue` (:2060) sans passer par le point d'accroche du verdict (:1973). Sur une
 *     reprise, un nœud intermédiaire choisit donc son arête avec le verdict de quelqu'un d'autre.
 *
 * (2) La lecture du verdict échoue OUVERT : `REJET_EN_TETE` ne teste que les PREMIERS mots, donc un
 *     juge muet, en panne, hors contrat, ou qui rejette en milieu de phrase, est lu VERT.
 */

/**
 * Provider scripté. Il ne DEVINE pas la phase depuis le prompt — une première version le faisait et
 * comptait « scout » trois fois, rendant trois assertions vides de sens : le nom d'une phase apparaît
 * aussi dans le contexte des phases suivantes. La phase autoritaire vient du moteur (`onPhase`).
 */
class ScriptedProvider implements ProviderAdapter {
  readonly id = 'scripted'
  readonly supportsExecution = true
  /** Réponse imposée quand le moteur annonce la phase `judge`. */
  verdictDuJuge = 'VALIDE'
  /** Positionné par le harnais depuis `onPhase` : la phase que le moteur exécute en ce moment. */
  phaseCourante: string | undefined

  async auth(): Promise<boolean> {
    return true
  }

  // L'interface ProviderAdapter impose un AsyncGenerator pour permettre le streaming ; ce faux
  // provider répond d'un bloc et n'a donc aucun morceau à émettre.
  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    const estJuge = this.phaseCourante === 'judge' || options.model === 'judge'
    return {
      text: estJuge ? this.verdictDuJuge : `travail de ${this.phaseCourante ?? 'inconnu'}`,
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence: estJuge
        ? undefined
        : [
            { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'm' },
            {
              type: 'command_execution',
              kind: 'verification',
              status: 'completed',
              ok: true,
              summary: 'v'
            }
          ]
    }
  }
}

/**
 * scout ─always─▶ judge1 ─red──▶ clean ─always─▶ frame
 *                   └───green──▶ build
 *
 * L'arête rouge ne va PAS vers `build` : le marcheur retire délibérément `judge --red--> build`
 * (orchestrator.ts:1893), cette boucle étant jouée en aval par la réparation. Chemin rouge et chemin
 * vert sont donc distinguables par la phase qui tourne réellement.
 */
const GRAPHE: WorkflowGraph = {
  entry: 'scout-1',
  nodes: [
    { id: 'scout-1', phase: 'scout' },
    { id: 'judge-1', phase: 'judge' },
    { id: 'clean-1', phase: 'clean' },
    { id: 'frame-1', phase: 'frame' },
    { id: 'build-1', phase: 'build' }
  ],
  edges: [
    { from: 'scout-1', to: 'judge-1', when: 'always' },
    { from: 'judge-1', to: 'clean-1', when: 'red' },
    { from: 'judge-1', to: 'build-1', when: 'green' },
    { from: 'clean-1', to: 'frame-1', when: 'always' }
  ]
}

function harnais(graph: WorkflowGraph = GRAPHE) {
  const provider = new ScriptedProvider()
  /** Les phases que LE MOTEUR déclare exécuter — la seule source qui ne se devine pas. */
  const phasesExecutees: string[] = []
  const onPhase = (p: { step: string; phase?: string }): void => {
    if (p.step !== 'exec' || !p.phase) return
    provider.phaseCourante = p.phase
    phasesExecutees.push(p.phase)
  }
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    authority: new AuthoritySas(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    execPhases: ['scout', 'build'],
    currentWorkflow: () => ({ graph })
  })
  /** Lance un run en branchant l'observateur de phases du moteur. */
  const lancer = (
    acquis: { phase: 'scout' | 'judge' | 'clean' | 'frame' | 'build'; text: string }[] = []
  ) =>
    orch.run(
      'modifie le projet',
      undefined,
      onPhase as never,
      undefined,
      undefined,
      undefined,
      acquis as never
    )
  return { orch, provider, phasesExecutees, lancer }
}

describe('le verdict d’un nœud judge est un fait, pas une variable', () => {
  it('sur REPRISE, un judge intermédiaire ROUGE fait prendre l’arête rouge — pas celle du dernier acquis', async () => {
    const { provider, phasesExecutees, lancer } = harnais()
    provider.verdictDuJuge = 'VALIDE'
    // L'acquis contient un judge ROUGE, PUIS une phase verte. Le pré-amorçage ne retient que la
    // dernière (clean → vert) et fait donc franchir l'arête VERTE au nœud judge-1.
    await lancer([
      { phase: 'scout', text: 'exploration acquise' },
      { phase: 'judge', text: 'DEFAUT: la fonction plante sur null' },
      { phase: 'clean', text: 'nettoyage acquis' }
    ])
    // Le chemin rouge mène à clean (déjà acquis) puis à frame. Le chemin vert mène à build.
    // Si le verdict de judge-1 est perdu, `build` tourne — la réparation est sautée en silence.
    expect(phasesExecutees).not.toContain('build')
  })

  it('un juge MUET ne vaut pas une approbation', async () => {
    const { provider, phasesExecutees, lancer } = harnais()
    provider.verdictDuJuge = '   '
    await lancer()
    expect(phasesExecutees).toContain('judge')
    // Preuve du fail-closed : l'arête ROUGE est franchie, donc `clean` (sa cible) tourne. Avant le
    // durcissement la séquence était scout→judge→build : l'arête VERTE, aucun `clean`.
    // `build` réapparaît en fin de séquence et c'est NORMAL — un rouge déclenche la boucle de
    // réparation, que le marcheur laisse volontairement en aval (orchestrator.ts:1887).
    expect(phasesExecutees).toContain('clean')
  })

  it('un juge EN PANNE ne vaut pas une approbation', async () => {
    const { provider, phasesExecutees, lancer } = harnais()
    provider.verdictDuJuge = 'Error: provider timeout after 30000ms'
    await lancer()
    expect(phasesExecutees).toContain('judge')
    // Preuve du fail-closed : l'arête ROUGE est franchie, donc `clean` (sa cible) tourne. Avant le
    // durcissement la séquence était scout→judge→build : l'arête VERTE, aucun `clean`.
    // `build` réapparaît en fin de séquence et c'est NORMAL — un rouge déclenche la boucle de
    // réparation, que le marcheur laisse volontairement en aval (orchestrator.ts:1887).
    expect(phasesExecutees).toContain('clean')
  })

  it('un rejet en MILIEU de phrase est un rejet', async () => {
    const { provider, phasesExecutees, lancer } = harnais()
    provider.verdictDuJuge = 'Le livrable présente un DEFAUT: il plante sur null'
    await lancer()
    expect(phasesExecutees).toContain('judge')
    // Preuve du fail-closed : l'arête ROUGE est franchie, donc `clean` (sa cible) tourne. Avant le
    // durcissement la séquence était scout→judge→build : l'arête VERTE, aucun `clean`.
    // `build` réapparaît en fin de séquence et c'est NORMAL — un rouge déclenche la boucle de
    // réparation, que le marcheur laisse volontairement en aval (orchestrator.ts:1887).
    expect(phasesExecutees).toContain('clean')
  })

  it('un VALIDE reste un VALIDE (le durcissement ne bloque pas le chemin vert)', async () => {
    const { provider, phasesExecutees, lancer } = harnais()
    provider.verdictDuJuge = 'VALIDE'
    await lancer()
    // Discriminant : si ce test devient rouge, le durcissement a mangé le chemin normal.
    expect(phasesExecutees).toContain('build')
  })

  it('« aucun DEFAUT trouvé » reste VERT — la frontière du faux positif', async () => {
    const { provider, phasesExecutees, lancer } = harnais()
    // Le piège du durcissement : chercher « DEFAUT » n'importe où ferait basculer CE texte en rouge,
    // alors qu'il approuve. Seule la forme du contrat (`DEFAUT:`) doit compter.
    provider.verdictDuJuge = 'Aucun DEFAUT trouve apres recherche serieuse. VALIDE'
    await lancer()
    expect(phasesExecutees).toContain('build')
  })
})
