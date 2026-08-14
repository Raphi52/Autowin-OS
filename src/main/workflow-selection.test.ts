import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  loadWorkflowSelections,
  workflowForConversation
} from './workflow-selection'

let dossier: string
let chemin: string

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'wf-sel-'))
  chemin = join(dossier, 'workflow-selection.json')
})
afterEach(() => rmSync(dossier, { recursive: true, force: true }))

describe('un workflow par conversation', () => {
  it('une conversation sans choix n’impose rien', () => {
    expect(workflowForConversation({ byConversation: {} }, 'conv-x')).toBeUndefined()
    expect(workflowForConversation({ byConversation: { a: 'x' } }, undefined)).toBeUndefined()
  })
})

describe('survie au disque', () => {
  it('un BOM ne fait pas perdre silencieusement tous les réglages', () => {
    // Déjà vu sur ce projet : PowerShell pose un BOM, JSON.parse jette, le catch retombe sur vide et
    // le réglage disparaît sans un mot.
    writeFileSync(chemin, '﻿' + JSON.stringify({ byConversation: { a: 'rapide' } }), 'utf8')
    expect(loadWorkflowSelections(chemin).byConversation).toEqual({ a: 'rapide' })
  })

  it('un fichier corrompu ne fait pas échouer le démarrage', () => {
    writeFileSync(chemin, 'pas du json', 'utf8')
    expect(loadWorkflowSelections(chemin)).toEqual({ byConversation: {} })
  })

  it('une valeur non textuelle est écartée, pas chargée', () => {
    writeFileSync(chemin, JSON.stringify({ byConversation: { a: 42, b: 'ok' } }), 'utf8')
    expect(loadWorkflowSelections(chemin).byConversation).toEqual({ b: 'ok' })
  })

  it('un fichier absent vaut « aucun choix »', () => {
    expect(loadWorkflowSelections(join(dossier, 'absent.json'))).toEqual({ byConversation: {} })
  })
})

describe('le choix atteint réellement le run du chat', () => {
  // Un magasin parfait que personne n'interroge au moment d'exécuter ne change RIEN au déroulé : le
  // défaut d'origine était exactement là — une sélection persistée que nul consommateur ne lisait.
  const os = readFileSync(new URL('./os.ts', import.meta.url), 'utf8')

  it('la façade pose le workflow de la conversation autour de l’appel à l’orchestrateur', () => {
    // La pose est ATTENDUE depuis le mode dynamique : choisir peut demander un appel de modèle.
    // On vérifie l'ordre pose-avant-run, pas la forme exacte de l'appel.
    const pose = os.indexOf('await this.poseConversationWorkflow(conversationId')
    // L'orchestrateur est construit PAR RUN autour du workflow résolu : la variable locale a
    // remplacé le champ d'instance, donc l'appel n'est plus `this.orchestrator.run(`.
    const run = os.indexOf('await orchestrator.run(', pose)
    expect(pose).toBeGreaterThan(-1)
    expect(run).toBeGreaterThan(pose) // posé AVANT, sinon le run part sans lui
  })

  /**
   * Le mode dynamique doit être ATTEINT quand aucun workflow n'est choisi à la main. Sans ce test,
   * `poseWorkflowDynamique` pourrait exister, être parfaitement testée, et n'être jamais appelée —
   * le défaut exact que ce fichier existe pour empêcher.
   */
  it('faute de choix manuel, le mode dynamique est sollicité', () => {
    expect(os).toMatch(/if \(!profileId\) return task \? await this\.poseWorkflowDynamique\(task\)/)
    // Et il retombe sur « aucun workflow » plutôt que d'empêcher le run de partir.
    expect(os).toMatch(/if \(!meriteUneDecision\(task\)\) return undefined/)
  })

  it('et le retire ensuite, y compris quand le run échoue', () => {
    // Il n'y a plus RIEN a retirer : le workflow vit dans la closure d'un orchestrateur construit
    // pour ce run seul. Le `finally` existait parce que la pose etait globale — sa disparition EST
    // la correction (cf. workflow-isolation.test.ts).
    expect(os).not.toMatch(/this\.activeWorkflow/)
  })

  it('la confrontation garde la priorité sur le workflow de la conversation', () => {
    // Sinon un banc lancé depuis une conversation comparerait son workflow à lui-même.
    expect(os).toMatch(/poseConversationWorkflow[\s\S]{0,500}if \(this\.workflowImpose\) return this\.workflowImpose/)
  })
})
