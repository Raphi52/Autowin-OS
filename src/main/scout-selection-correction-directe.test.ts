/**
 * LA CORRECTION DIRECTE NE JOUE QUE LA CORRECTION — preuve HORS du texte (conv-1080).
 *
 * Le bouton « Corriger directement » du panneau des candidats scout envoie un message préfixé
 * `/build`. Ce test passe le message RÉEL au routeur du chat puis au routeur de phases : il doit en
 * sortir la seule phase build (le juge est ajouté par l'orchestrateur), la capitalisation `learn`, et
 * la mémoire du scout doit toujours reconnaître les pistes prises.
 */
import { describe, expect, it } from 'vitest'
import { routeSkillRequest } from './skill-routing'
import { phasesApresJugeHorsGraphe, regimePhases } from './task-regime'
import { titresChoisisDansLaDemande } from './scout-memoire'
import { sujetDeCommit } from './scout-plafond'
import {
  redigerPromptCorrectionDirecte,
  redigerPromptWorkflowSelection
} from '../renderer/src/components/veille-candidats-message'

describe('bouton « Corriger directement » de la shortlist scout', () => {
  const selection = [
    { titre: 'Compteur jamais remis à zéro', type: 'fix', url: 'src/main/compteur.ts:42' },
    { titre: 'Journal permissif', type: 'fix', url: 'src/main/activity/ledger.ts:63' }
  ]
  const prompt = redigerPromptCorrectionDirecte(selection)
  const route = routeSkillRequest(prompt)

  it('est une phase NOMMÉE, orchestrée sans réinterprétation du modèle du chat', () => {
    expect(route?.reason).toBe('explicit-skill')
    expect(route?.explicitPhase).toBe('build')
  })

  it('ne joue que build — ni scout, ni cadrage, ni nettoyage', () => {
    expect(regimePhases(route!.task)).toEqual(['build'])
  })

  it('garde la capitalisation après le juge', () => {
    expect(phasesApresJugeHorsGraphe(route!.task)).toEqual(['learn'])
  })

  it('la mémoire du scout note toujours les pistes prises', () => {
    expect(titresChoisisDansLaDemande(route!.task)).toEqual([
      'Compteur jamais remis à zéro',
      'Journal permissif'
    ])
  })

  it('le sujet de commit ne garde ni /build ni l’en-tête de sélection', () => {
    expect(sujetDeCommit(`agent run-ab12: ${route!.task.split('\n')[0]}`)).toBe('')
  })

  it('le workflow complet, lui, garde cadrage, build et nettoyage', () => {
    expect(regimePhases(redigerPromptWorkflowSelection(selection))).toEqual([
      'frame',
      'build',
      'clean'
    ])
  })
})
