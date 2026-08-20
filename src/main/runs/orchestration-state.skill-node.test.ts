import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOrchestrationStates, saveOrchestrationState } from './orchestration-state'

/**
 * L'acquis d'un nœud SKILL doit survivre à un rechargement.
 *
 * Le filtre de relecture exigeait l'appartenance à `PIPELINE_PHASES` : la sortie d'un nœud skill
 * était rejetée EN SILENCE. Le run s'exécutait, produisait son texte, et l'acquis disparaissait au
 * premier rechargement — une reprise repartait de zéro sans rien dire à personne.
 */
describe('persistance d’un nœud skill', () => {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-skill-node-'))

  it('relit la sortie d’un nœud skill au même titre qu’une phase', () => {
    saveOrchestrationState(racine, {
      runId: 'run-skill-1',
      task: 'remets-toi dans ce dépôt',
      startedAt: 1,
      updatedAt: 2,
      phaseOutputs: [
        { phase: 'think', text: 'empreinte rechargée' },
        { phase: 'frame', text: 'besoin cadré' }
      ]
    } as never)
    const relu = loadOrchestrationStates(racine).find((s) => s.runId === 'run-skill-1')
    expect(relu?.phaseOutputs?.map((o) => o.phase)).toEqual(['think', 'frame'])
    expect(relu?.phaseOutputs?.[0].text).toBe('empreinte rechargée')
  })

  it('refuse toujours un identifiant malforme — le filtre n a pas ete rendu passoire', () => {
    // Refuse des l ECRITURE (garde causale en amont), ce qui est plus strict que le filtre de
    // relecture : un checkpoint corrompu n atteint jamais le disque.
    expect(() =>
      saveOrchestrationState(racine, {
        runId: 'run-skill-2',
        task: 'x',
        startedAt: 1,
        updatedAt: 2,
        phaseOutputs: [{ phase: '../../evasion', text: 'corrompu' }]
      } as never)
    ).toThrow()
  })


  it('accepte une REFERENCE D AGENT portant une phase de skill', () => {
    /**
     * Le trou que ce test bouche, trouve par un run REEL et par rien d'autre.
     *
     * Le controle runtime des references d'agent etait reste sur la liste FERMEE des huit phases,
     * alors que le type venait d'etre elargi. Des qu'un agent etait enregistre pour un noeud skill,
     * le checkpoint ENTIER devenait invalide et le run mourait sur
     * « checkpoint orchestration causalement invalide » — avant meme sa premiere phase.
     *
     * 7058 tests verts et un audit ne l'avaient pas vu : la preuve de persistance existante
     * exercait la sortie de phase, jamais l'agent qui la produit.
     */
    expect(() =>
      saveOrchestrationState(racine, {
        runId: 'run-skill-agent',
        task: 'remets-toi dans ce depot',
        startedAt: 1,
        updatedAt: 2,
        phaseOutputs: [{ phase: 'think', text: 'briefing' }],
        agents: [{ token: 'agent-1', phase: 'think', active: false }]
      } as never)
    ).not.toThrow()
    const relu = loadOrchestrationStates(racine).find((s) => s.runId === 'run-skill-agent')
    expect(relu?.agents?.[0].phase).toBe('think')
  })

  it('refuse toujours une phase d agent malformee', () => {
    expect(() =>
      saveOrchestrationState(racine, {
        runId: 'run-skill-agent-ko',
        task: 'x',
        startedAt: 1,
        updatedAt: 2,
        phaseOutputs: [],
        agents: [{ token: 'agent-1', phase: '../../evasion' }]
      } as never)
    ).toThrow()
  })

  it('nettoyage', () => {
    rmSync(racine, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
