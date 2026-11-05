// @vitest-environment happy-dom
/**
 * « AFFICHER LES AGENTS DE » (demande utilisateur du 2026-11-05, conv-1599) : la liste des personnes du
 * partage, revalidée, et les cases de CE poste qui retirent les agents d'une personne de la scène.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { PresencesDesCollegues } from '../../../shared/quartier-presence'
import {
  afficherLesAgentsDe,
  agentsDesCollegues,
  CLE_MASQUES_LOCAUX,
  couleurDuPoste,
  lireAgentsCollegues,
  lireMasquesLocaux,
  masquesLocauxLus,
  oublierAgentsCollegues,
  personnesDuVillage,
  poserAgentsCollegues
} from './agents-collegues'

const MAINTENANT = Date.parse('2026-11-05T09:00:00.000Z')
const agent = (id: string) => ({
  id,
  phase: 'travail' as const,
  metier: 'lire',
  depuis: new Date(MAINTENANT - 60_000).toISOString()
})
const presences: PresencesDesCollegues = {
  collegues: [
    { poste: 'Alice', nom: 'Alice Martin', prenom: 'Alice', agents: [agent('conv-1')] },
    { poste: 'bob', nom: 'Bob Durand', prenom: 'Bob', agents: [agent('conv-2')] }
  ],
  personnes: [
    { poste: 'bob', prenom: 'Bob', enLigne: true },
    { poste: 'Alice', prenom: 'Alice', enLigne: true },
    { poste: 'carol', prenom: 'Carol', enLigne: false },
    { poste: 'ALICE', prenom: 'Doublon', enLigne: true },
    { poste: 'x'.repeat(200), prenom: 'Piège', enLigne: true }
  ]
}

afterEach(() => {
  oublierAgentsCollegues()
  window.localStorage.clear()
})

describe('personnesDuVillage', () => {
  it('rend chaque personne une fois, rangée par prénom, avec son foulard et son état', () => {
    expect(personnesDuVillage(presences)).toEqual([
      { poste: 'Alice', prenom: 'Alice', couleur: couleurDuPoste('Alice'), enLigne: true },
      { poste: 'bob', prenom: 'Bob', couleur: couleurDuPoste('bob'), enLigne: true },
      { poste: 'carol', prenom: 'Carol', couleur: couleurDuPoste('carol'), enLigne: false }
    ])
  })

  it('sans `personnes` (processus principal d’avant le réglage), retombe sur les collègues en ligne', () => {
    expect(
      personnesDuVillage({ collegues: presences.collegues }).map((p) => [p.poste, p.enLigne])
    ).toEqual([
      ['Alice', true],
      ['bob', true]
    ])
    expect(personnesDuVillage(null)).toEqual([])
  })
})

describe('les cases « afficher les agents de »', () => {
  it('décocher une personne retire ses agents de la scène, la recocher les rend', () => {
    poserAgentsCollegues(agentsDesCollegues(presences, MAINTENANT))
    expect(lireAgentsCollegues().map((a) => a.collegue.poste)).toEqual(['Alice', 'bob'])
    afficherLesAgentsDe('ALICE', false)
    expect(lireAgentsCollegues().map((a) => a.collegue.poste)).toEqual(['bob'])
    expect(JSON.parse(window.localStorage.getItem(CLE_MASQUES_LOCAUX) ?? '[]')).toEqual(['alice'])
    afficherLesAgentsDe('Alice', true)
    expect(lireAgentsCollegues().map((a) => a.collegue.poste)).toEqual(['Alice', 'bob'])
  })

  it('le choix est relu au démarrage ; un contenu abîmé ne masque personne', () => {
    window.localStorage.setItem(CLE_MASQUES_LOCAUX, JSON.stringify(['bob']))
    expect(lireMasquesLocaux()).toEqual(['bob'])
    expect(masquesLocauxLus('{ pas du json')).toEqual([])
    expect(masquesLocauxLus('"bob"')).toEqual([])
  })
})
