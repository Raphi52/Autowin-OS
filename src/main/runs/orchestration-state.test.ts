import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  clearOrchestrationState,
  loadOrchestrationStates,
  pickOrchestrationToResume,
  saveOrchestrationState,
  type OrchestrationRunState
} from './orchestration-state'

let root: string
const state = (runId: string, updatedAt: number, phases: string[]): OrchestrationRunState => ({
  runId,
  task: 'ajoute un bouton',
  phaseOutputs: phases.map((phase) => ({ phase: phase as never, text: `livrable ${phase}` })),
  startedAt: updatedAt - 1000,
  updatedAt
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orch-state-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('état reprenable d’orchestration (survie niveau 3)', () => {
  it('persiste puis relit un run, et l’efface à la clôture', () => {
    saveOrchestrationState(root, state('run-a-1', 1000, ['frame']))
    expect(loadOrchestrationStates(root).map((s) => s.runId)).toEqual(['run-a-1'])
    clearOrchestrationState(root, 'run-a-1')
    expect(loadOrchestrationStates(root)).toEqual([])
  })

  it('n’écrit pas de fichier temporaire résiduel (écriture atomique)', () => {
    saveOrchestrationState(root, state('run-a-1', 1000, ['frame']))
    saveOrchestrationState(root, state('run-a-1', 2000, ['frame', 'terrain']))
    expect(readdirSync(root)).toEqual(['run-a-1.json'])
    expect(loadOrchestrationStates(root)[0].phaseOutputs).toHaveLength(2)
  })

  it('reprend le run le PLUS RÉCENT qui a déjà produit une phase', () => {
    saveOrchestrationState(root, state('run-a-1', 1000, ['frame']))
    saveOrchestrationState(root, state('run-a-2', 5000, ['frame', 'terrain']))
    saveOrchestrationState(root, state('run-a-3', 9000, [])) // aucun acquis → non reprenable
    expect(pickOrchestrationToResume(loadOrchestrationStates(root))?.runId).toBe('run-a-2')
  })

  it('ignore un état tronqué par un crash sans perdre les autres', () => {
    saveOrchestrationState(root, state('run-a-1', 1000, ['frame']))
    writeFileSync(join(root, 'run-corrompu.json'), '{"runId":"run-corrompu","task":', 'utf8')
    expect(loadOrchestrationStates(root).map((s) => s.runId)).toEqual(['run-a-1'])
  })

  it('refuse un runId qui sortirait du dossier (traversée de chemin)', () => {
    expect(() => saveOrchestrationState(root, state('../evasion', 1000, ['frame']))).toThrow(
      /runId invalide/
    )
  })

  it('rien à reprendre → null (démarrage normal inchangé)', () => {
    expect(pickOrchestrationToResume([])).toBeNull()
    expect(pickOrchestrationToResume(loadOrchestrationStates(join(root, 'absent')))).toBeNull()
  })
})

describe('garde-fou acquis vide (constaté en réel)', () => {
  it('ne propose PAS de reprendre un run dont les phases n’ont aucun livrable', () => {
    // Cas observé : un run interrompu avait persisté `frame` avec 0 caractère. Le reprendre
    // ferait SAUTER frame sans avoir son travail → pire que de tout rejouer.
    const empty: OrchestrationRunState = {
      runId: 'run-vide-1',
      task: 'ajoute un bouton',
      phaseOutputs: [{ phase: 'frame' as never, text: '   ' }],
      startedAt: 1,
      updatedAt: 2
    }
    expect(pickOrchestrationToResume([empty])).toBeNull()
  })

  it('reprend dès qu’au moins une phase porte un livrable réel', () => {
    const mixed: OrchestrationRunState = {
      runId: 'run-mixte-1',
      task: 'ajoute un bouton',
      phaseOutputs: [
        { phase: 'frame' as never, text: 'besoin cadré' },
        { phase: 'terrain' as never, text: '' }
      ],
      startedAt: 1,
      updatedAt: 2
    }
    expect(pickOrchestrationToResume([mixed])?.runId).toBe('run-mixte-1')
  })
})
