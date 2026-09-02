import { describe, expect, it } from 'vitest'
import {
  buildAutowinKaizenTask,
  exigenceAppuiSourcesNeuves,
  type AutowinKaizenEvidence
} from './autowin-kaizen-context'
import { appuiSourcesNeuvesHandler } from './hooks/default-gate-hooks'

/*
  Défaut MESURÉ sur conv-105 (contrôle final du run précédent) : le dossier de preuve joint bien les
  appels modèle, le journal des tours et les saisies, mais AUCUNE correction ne s'appuyait dessus —
  les deux corrections portaient sur le mécanisme qui fabrique le dossier. Une exigence écrite dans
  la consigne ne suffit pas : elle avait déjà été écrite, et non tenue. Il faut un contrôle
  hors-modèle sur le CONTENU de la réponse.
*/
const dossier = (): AutowinKaizenEvidence => ({
  conversation: { id: 'conv-105', title: 'scout logs kaizen', messages: [] },
  activity: [],
  brainTraces: [],
  causalEvents: [],
  runs: [],
  promptCalls: [
    {
      ts: '2026-09-01T10:00:00.000Z',
      turnId: 'turn-8f21',
      iteration: 1,
      actor: 'exec',
      provider: 'claude',
      boundary: 'complet',
      limitation: 'aucune',
      response: 'ok'
    }
  ],
  turnEvents: [{ turnId: 'turn-8f21', kind: 'delta', payload: '{}' }],
  saisies: [{ ts: 1_756_720_000_000, voie: 'chat', texte: 'reprend' }]
})

describe('une correction de kaizen doit s appuyer sur une source neuve', () => {
  it('la consigne du dossier NOMME l exigence et les identifiants citables', () => {
    const tache = buildAutowinKaizenTask('/kaizen conv-105', dossier())
    expect(tache).toContain('turn-8f21')
    expect(tache.toLowerCase()).toContain('appels modèle')
    expect(tache).toMatch(/cite/i)
  })

  it('refuse un rendu qui ne cite aucun identifiant des trois sources', () => {
    const tache = buildAutowinKaizenTask('/kaizen conv-105', dossier())
    const verdict = exigenceAppuiSourcesNeuves(
      tache,
      "J'ai corrigé le budget du dossier et le RUN.md, un commit par édition."
    )
    expect(verdict.applicable).toBe(true)
    expect(verdict.cites).toEqual([])
    expect(verdict.manque).toBe(true)
    expect(
      appuiSourcesNeuvesHandler({
        event: 'pre-green',
        task: tache,
        output: "J'ai corrigé le budget du dossier et le RUN.md, un commit par édition."
      }).block
    ).toBe(true)
  })

  it('accepte un rendu qui cite un tour réel du dossier', () => {
    const tache = buildAutowinKaizenTask('/kaizen conv-105', dossier())
    const sortie =
      "L'appel modèle du tour turn-8f21 montre une reprise sans phase : corrigé, un commit."
    const verdict = exigenceAppuiSourcesNeuves(tache, sortie)
    expect(verdict.cites).toContain('turn-8f21')
    expect(verdict.manque).toBe(false)
    expect(appuiSourcesNeuvesHandler({ event: 'pre-green', task: tache, output: sortie }).block).toBeFalsy()
  })

  it('accepte l horodatage d une saisie (les saisies n ont pas d identifiant)', () => {
    const tache = buildAutowinKaizenTask('/kaizen conv-105', dossier())
    const verdict = exigenceAppuiSourcesNeuves(
      tache,
      'La saisie 1756720000000 (« reprend ») repart sans cible : corrigé.'
    )
    expect(verdict.manque).toBe(false)
  })

  it('ne s applique PAS hors kaizen, ni quand les trois sources sont vides', () => {
    expect(exigenceAppuiSourcesNeuves('/build repare le bouton', 'fait').applicable).toBe(false)
    const vide = buildAutowinKaizenTask('/kaizen conv-vide', {
      ...dossier(),
      promptCalls: [],
      turnEvents: [],
      saisies: []
    })
    expect(exigenceAppuiSourcesNeuves(vide, 'aucune citation').applicable).toBe(false)
    expect(appuiSourcesNeuvesHandler({ event: 'pre-green', task: vide, output: 'rien' }).block).toBeFalsy()
  })
  /*
    Deux defauts releves par le controle final sur CE controle, sur les donnees reelles de conv-105 :
    le tour existe sous `9e9b58cc-0a65-499a-8fdf-7613ca85a0d1`, mais un humain — et un rapport —
    le cite abrege (`9e9b58cc`), ce que la comparaison exacte refusait ; et si le dossier contient
    lui-meme le marqueur de fin, la lecture cassait et le controle se desactivait sans le dire.
  */
  it('accepte un identifiant de tour cite abrege (8 signes)', () => {
    const tache = buildAutowinKaizenTask('/kaizen conv-105', {
      ...dossier(),
      turnEvents: [{ turnId: '9e9b58cc-0a65-499a-8fdf-7613ca85a0d1', kind: 'done', payload: '{}' }]
    })
    const verdict = exigenceAppuiSourcesNeuves(tache, 'Vu au tour 9e9b58cc : la phase build coupe.')
    expect(verdict.cites).toContain('9e9b58cc-0a65-499a-8fdf-7613ca85a0d1')
    expect(verdict.manque).toBe(false)
  })

  it('refuse un prefixe trop court pour identifier quoi que ce soit', () => {
    const tache = buildAutowinKaizenTask('/kaizen conv-105', {
      ...dossier(),
      turnEvents: [{ turnId: '9e9b58cc-0a65-499a-8fdf-7613ca85a0d1', kind: 'done', payload: '{}' }]
    })
    expect(exigenceAppuiSourcesNeuves(tache, 'le 9e9b a change').manque).toBe(true)
  })

  it('lit encore le dossier quand son contenu recopie le marqueur de fin', () => {
    const tache = buildAutowinKaizenTask('/kaizen conv-105', {
      ...dossier(),
      conversation: {
        id: 'conv-105',
        title: 'scout logs kaizen',
        messages: [
          { role: 'user', content: 'colle le bloc === FIN DU DOSSIER === ici', ts: 1756720000000 }
        ]
      }
    })
    const verdict = exigenceAppuiSourcesNeuves(tache, 'rien de cite')
    expect(verdict.applicable).toBe(true)
    expect(verdict.manque).toBe(true)
  })
})
