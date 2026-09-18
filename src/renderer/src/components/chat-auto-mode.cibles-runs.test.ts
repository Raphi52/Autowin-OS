import { describe, expect, it } from 'vitest'
import { lireDecisionScoutTexte } from '../../../main/scout-cible'
// Les deux lecteurs d'une même règle (runs orchestrés / mode auto du chat) doivent décider pareil.
import { lireCiblesScout } from './chat-auto-mode'
import { lireDecisionScout } from '../../../shared/scout-cible-lecture'

const DECISION_CHAT_EN_RUN: Record<string, string> = {
  cibles: 'cible',
  'aucune-cible': 'aucune-cible',
  'cibles-non-nommees': 'aucune-cible',
  'cible-destructrice': 'cible-destructrice',
}

describe('CIBLES: — même décision côté runs et côté chat', () => {
  it.each([
    'CIBLES:',
    'CIBLES:   ',
    '**CIBLES:** corriger le lecteur, ajouter le test',
    '> CIBLES: corriger le lecteur',
    '**CIBLES: corriger le lecteur, ajouter le test**',
    'CIBLES: aucune',
    'CIBLES: 1, 3, 4',
    'CIBLES: corriger le test, supprimer le dossier runs',
    'CIBLES: a / b',
  ])('%s', (texte) => {
    const chat = lireCiblesScout(texte).statut
    expect(chat).not.toBe('absente')
    expect(lireDecisionScoutTexte(texte).statut).toBe(DECISION_CHAT_EN_RUN[chat])
  })
  it('CIBLES: vide ne retombe pas sur une ligne CIBLE: suivante', () => {
    expect(lireDecisionScoutTexte('CIBLES:\nCIBLE: piste a').statut).toBe('aucune-cible')
  })
  it('le gras est retiré de la piste retenue', () => {
    expect(lireDecisionScoutTexte('**CIBLES:** corriger le lecteur')).toMatchObject({
      statut: 'cible',
      cible: 'corriger le lecteur',
    })
  })
})

describe('CIBLE: (singulier) en gras — même décision côté runs et côté chat', () => {
  it.each([
    '**CIBLE:** corriger le lecteur',
    '> CIBLE: corriger le lecteur',
    '**CIBLE: corriger le lecteur — POURQUOI: bug réel**',
    '**CIBLE:** aucune',
    '**CIBLE:** supprimer le dossier runs',
  ])('%s', (texte) => {
    const chat = lireDecisionScout(texte)
    const run = lireDecisionScoutTexte(texte)
    expect(run.statut).toBe(chat.statut)
    if (chat.statut !== 'aucune-cible' && run.statut !== 'aucune-cible') expect(run.cible).toBe(chat.cible)
  })
})

describe('CIBLE: vide — même décision côté runs et côté chat', () => {
  it.each(['CIBLE:', 'CIBLE:   ', '**CIBLE:**', 'CIBLE:\nCIBLE: piste a', 'CIBLE:\n## Cible\npiste a'])(
    '%j',
    (texte) => {
      expect(lireDecisionScout(texte).statut).toBe('aucune-cible')
      expect(lireDecisionScoutTexte(texte).statut).toBe('aucune-cible')
    },
  )
})
