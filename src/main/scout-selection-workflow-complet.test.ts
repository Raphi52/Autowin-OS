/**
 * Demande utilisateur du 2026-09-02 : « quand je scoot le bouton doit lancer tout le workflow et pas
 * uniquement le frame ». Le bouton de la shortlist scout envoyait un prompt prefixe `/frame`, qui
 * REDUIT le run a la seule phase frame. Preuve HORS du texte : le prompt reel du bouton est passe au
 * routeur de phases, qui doit rendre les CINQ phases (le juge est ajoute par l'orchestrateur).
 */
import { describe, expect, it } from 'vitest'
import { regimePhases } from './task-regime'
import { redigerPromptWorkflowSelection } from '../renderer/src/components/veille-candidats-message'

describe('bouton de la shortlist scout', () => {
  const prompt = redigerPromptWorkflowSelection([
    { titre: 'File de reprise groupee', url: 'src/renderer/src/components/chat-home-suggestions.ts:59' },
    { titre: 'Journal permissif', url: 'src/main/activity/ledger.ts:63' }
  ])

  it('lance le pipeline COMPLET, pas la seule phase frame', () => {
    expect(regimePhases(prompt)).toEqual(['scout', 'frame', 'terrain', 'build', 'clean'])
  })

  it('ne porte plus aucun prefixe de phase', () => {
    expect(prompt.trimStart()).not.toMatch(/^\//)
  })
})
