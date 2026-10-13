import { describe, expect, it } from 'vitest'
import { bilanDepuisCloture, lireVerdictDuJuge } from './run-bilan'

/**
 * Bilan du nœud « Clôture du run » (demande du 2026-10-13) : verdict, durée, coût, raisons.
 * Les textes de juge ci-dessous reprennent la FORME réelle des réponses gardées dans la trace
 * (`causal-trace/conv-911.jsonl`, `conv-914.jsonl`) : un récit d'abord, le verdict ensuite.
 */
describe('bilanDepuisCloture', () => {
  it('un run VERT donne sa durée, son coût et son intégration', () => {
    const bilan = bilanDepuisCloture(
      {
        status: 'green',
        totalDurationMs: 2_482_796,
        totalCostUsd: 14.4502759,
        integrationOutcome: 'merged'
      },
      { titre: 'Corrige le bouton', passagesDuJuge: 3 }
    )
    expect(bilan.verdict).toBe('vert')
    expect(bilan.titre).toBe('Corrige le bouton')
    expect(bilan.lignes).toEqual([
      { label: 'Clôture', valeur: 'acceptée' },
      { label: 'Durée', valeur: '41 min 23 s' },
      { label: 'Coût', valeur: '14.45 $' },
      { label: 'Intégration', valeur: 'fusionné dans la base' },
      { label: 'Passages du juge', valeur: '3' }
    ])
  })

  it('un run OUVERT ne présente pas « 0 ms · 0 $ » comme une mesure', () => {
    const bilan = bilanDepuisCloture({ status: 'open', totalDurationMs: 0, totalCostUsd: 0 })
    expect(bilan.verdict).toBe('en cours')
    expect(bilan.lignes.map((ligne) => ligne.label)).toEqual(['Clôture'])
    expect(bilan.lignes[0].valeur).toBe('pas encore close')
  })

  it('seul `green` verdit : une clôture dégradée est rouge, et le dit', () => {
    const bilan = bilanDepuisCloture({
      status: 'degraded-closed',
      totalDurationMs: 1_000,
      totalCostUsd: 0.5,
      usage: { unpricedCalls: 2 }
    })
    expect(bilan.verdict).toBe('rouge')
    expect(bilan.lignes).toContainEqual({ label: 'Clôture', valeur: 'close en mode dégradé' })
    expect(bilan.lignes).toContainEqual({ label: 'Coût', valeur: '0.50 $ + 2 appel(s) sans prix' })
  })
})

describe('lireVerdictDuJuge', () => {
  it('prend le verdict APRÈS le récit, pas la première ligne du texte', () => {
    const texte = [
      'Je récupère le texte complet de la dernière version du résultat.',
      '',
      'Tests verts (52/52, code 0).',
      '',
      'VALIDE',
      '',
      'SCORE: 88',
      '',
      'OBJECTIONS:',
      '- OK: aucune cible `chemin:ligne` dans la tâche.',
      '- OK: hors run — la piste 6 ne se vérifie qu’en conditions réelles.'
    ].join('\n')
    expect(lireVerdictDuJuge(texte)).toEqual({
      conclusion: 'VALIDE',
      valide: true,
      score: 88,
      puces: [
        { gravite: 'OK', texte: 'aucune cible `chemin:ligne` dans la tâche.' },
        { gravite: 'OK', texte: 'hors run — la piste 6 ne se vérifie qu’en conditions réelles.' }
      ]
    })
  })

  it('un refus garde sa raison et la gravité de chaque puce', () => {
    const texte = [
      'Je vérifie la piste 4.',
      '',
      'DEFAUT: piste 4 non faite',
      '',
      'SCORE: 68',
      'OBJECTIONS:',
      '- **MAJEUR**: la piste 4 manque, preuve dans `orchestrator.ts`.',
      '- MINEUR: libellé à reprendre.',
      '- une puce sans étiquette'
    ].join('\n')
    const verdict = lireVerdictDuJuge(texte)
    expect(verdict?.valide).toBe(false)
    expect(verdict?.conclusion).toBe('DEFAUT: piste 4 non faite')
    expect(verdict?.score).toBe(68)
    expect(verdict?.puces).toEqual([
      { gravite: 'MAJEUR', texte: 'la piste 4 manque, preuve dans `orchestrator.ts`.' },
      { gravite: 'MINEUR', texte: 'libellé à reprendre.' },
      { texte: 'une puce sans étiquette' }
    ])
  })

  it('sans ligne VALIDE ni DEFAUT, rien n’est inventé', () => {
    expect(lireVerdictDuJuge('Je regarde le code… puis la session a été coupée.')).toBeUndefined()
  })
})
