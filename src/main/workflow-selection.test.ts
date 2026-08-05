import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  loadWorkflowSelections,
  pruneWorkflowSelections,
  refusExplicite,
  saveWorkflowSelections,
  selectWorkflowForConversation,
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
  it('deux conversations gardent chacune le sien', () => {
    // C'est tout l'intérêt du choix « par conversation » : un fil en Rapide pendant qu'un autre est
    // en Rigoureux, sans basculer un réglage global à chaque fois.
    let sel = selectWorkflowForConversation({ byConversation: {} }, 'conv-a', 'rapide')
    sel = selectWorkflowForConversation(sel, 'conv-b', 'rigoureux')
    expect(workflowForConversation(sel, 'conv-a')).toBe('rapide')
    expect(workflowForConversation(sel, 'conv-b')).toBe('rigoureux')
  })

  /**
   * Contrat CHANGÉ le 2026-08-05, après un audit de l'application sur son propre code : effacer
   * l'entrée rendait un refus EXPLICITE indiscernable de « jamais choisi ». Le mode dynamique
   * réimposait alors un workflow que l'utilisateur venait de retirer — la laisse exacte que ce
   * chantier veut éviter. Un refus est une décision : il se persiste.
   */
  it('détacher enregistre un REFUS explicite, discernable de « jamais choisi »', () => {
    const sel = selectWorkflowForConversation(
      { byConversation: { 'conv-a': 'rapide' } },
      'conv-a',
      null
    )
    expect(refusExplicite(sel, 'conv-a')).toBe(true)
    // Une conversation qui ne s'est jamais prononcée reste, elle, indéterminée.
    expect(refusExplicite(sel, 'conv-jamais-vue')).toBe(false)
    expect(workflowForConversation(sel, 'conv-jamais-vue')).toBeUndefined()
  })

  it('une conversation sans choix n’impose rien', () => {
    expect(workflowForConversation({ byConversation: {} }, 'conv-x')).toBeUndefined()
    expect(workflowForConversation({ byConversation: { a: 'x' } }, undefined)).toBeUndefined()
  })
})

describe('survie au disque', () => {
  it('écrit puis relu à l’identique', () => {
    saveWorkflowSelections({ byConversation: { 'conv-a': 'rapide' } }, chemin)
    expect(loadWorkflowSelections(chemin).byConversation).toEqual({ 'conv-a': 'rapide' })
  })

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

describe('ménage', () => {
  it('oublie les conversations disparues', () => {
    // Sinon le fichier grossit sans fin, et une conversation recréée avec le même id hériterait d'un
    // réglage qu'on croyait effacé.
    const sel = pruneWorkflowSelections({ byConversation: { vivante: 'a', morte: 'b' } }, [
      'vivante'
    ])
    expect(sel.byConversation).toEqual({ vivante: 'a' })
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
    const run = os.indexOf('await this.orchestrator.run(', pose)
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
    expect(os).toMatch(/if \(!meriteUneDecision\(task\)\) return false/)
  })

  it('et le retire ensuite, y compris quand le run échoue', () => {
    expect(os).toMatch(/finally \{[\s\S]{0,200}if \(posed\) this\.activeWorkflow = undefined/)
  })

  it('la confrontation garde la priorité sur le workflow de la conversation', () => {
    // Sinon un banc lancé depuis une conversation comparerait son workflow à lui-même.
    expect(os).toMatch(/poseConversationWorkflow[\s\S]{0,400}if \(this\.activeWorkflow\) return false/)
  })
})

describe('le renderer peut choisir', () => {
  const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  const preload = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8')

  it('les canaux existent et vérifient l’émetteur avant d’écrire', () => {
    expect(index).toContain("ipcMain.handle('os:workflowSelection:set'")
    expect(index).toMatch(
      /os:workflowSelection:set[\s\S]{0,200}assertTrustedRendererSender/
    )
  })

  it('le preload les expose', () => {
    expect(preload).toContain("ipcRenderer.invoke('os:workflowSelection:get'")
    expect(preload).toContain("ipcRenderer.invoke('os:workflowSelection:set'")
  })
})
