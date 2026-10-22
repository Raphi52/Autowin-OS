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

  // Sans scout depuis le 2026-10-22 (conv-1080) : la sélection sort d'un scout, le rejouer était un
  // doublon payé (`selection-sans-scout.test.ts`). Cadrage, build et nettoyage restent tous là.
  it('lance le pipeline COMPLET, pas la seule phase frame — sans rejouer le scout', () => {
    expect(regimePhases(prompt)).toEqual(['frame', 'build', 'clean'])
  })

  it('ne demande plus terrain : la consigne suit la chaîne par défaut (2026-10-15)', () => {
    expect(prompt).not.toMatch(/terrain/iu)
  })

  it('ne porte plus aucun prefixe de phase', () => {
    expect(prompt.trimStart()).not.toMatch(/^\//)
  })
})
