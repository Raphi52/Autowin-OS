/**
 * La règle qui retient les lots d'une sélection scout après une coupure par la limite de quota
 * (conv-1080, 2026-10-22). Les refus sont recopiés des formes réelles : tour en échec (conv-1055 à
 * 11:01), échec rendu par la seule réponse de `pilotChat` (part d'erreur, `error` vide), et run du
 * lot suspendu alors que le tour du chat se clôt.
 */
import { describe, expect, it } from 'vitest'
import {
  coupureParQuotaDuDernierTour,
  lotsRetenusParLeQuota,
  type MessageDuFilLu
} from './lots-retenus-quota'

const REFUS =
  "Claude a interrompu l'appel : You've hit your session limit · resets 11:30am (Europe/Paris)"
const demande = { role: 'user' }

describe('coupureParQuotaDuDernierTour', () => {
  it('tour en échec sur le mur : rend le refus', () => {
    expect(
      coupureParQuotaDuDernierTour([demande, { role: 'assistant', status: 'failed', error: REFUS }])
    ).toBe(REFUS)
  })

  it('échec rendu par la seule part d’erreur (error vide) : rend aussi le refus', () => {
    expect(
      coupureParQuotaDuDernierTour([
        demande,
        {
          role: 'assistant',
          status: 'failed',
          parts: [{ kind: 'error', cause: 'turn', message: REFUS }]
        }
      ])
    ).toBe(REFUS)
  })

  it('tour clos mais run du lot suspendu par le mur (chaîne ou issue) : rend le refus', () => {
    const refusDuRun =
      "Phase build — claude : You've hit your weekly limit · resets 5am (Europe/Paris)"
    for (const data of [refusDuRun, { status: 'failed', error: refusDuRun }]) {
      expect(
        coupureParQuotaDuDernierTour([
          demande,
          {
            role: 'assistant',
            status: 'completed',
            parts: [{ kind: 'action', name: 'orchestrate', ok: false, data }]
          }
        ])
      ).toBe(refusDuRun)
    }
  })

  it('ne retient pas : rate-limit passager, autre erreur, run réussi, tour pas encore répondu', () => {
    const cas: MessageDuFilLu[][] = [
      [
        demande,
        { role: 'assistant', status: 'failed', error: 'Rate limit exceeded, retry after 20s' }
      ],
      [
        demande,
        { role: 'assistant', status: 'failed', error: 'Le processus Claude s’est arrêté (code 1).' }
      ],
      [
        demande,
        {
          role: 'assistant',
          status: 'completed',
          parts: [{ kind: 'action', name: 'orchestrate', ok: true, data: { status: 'succeeded' } }]
        }
      ],
      // Le refus est plus haut, mais une demande est partie depuis : son tour n'a pas d'issue.
      [demande, { role: 'assistant', status: 'failed', error: REFUS }, demande],
      // Une part d'erreur sans échec du tour (rattrapée) ne suffit pas.
      [
        demande,
        { role: 'assistant', status: 'completed', parts: [{ kind: 'error', message: REFUS }] }
      ]
    ]
    for (const fil of cas) expect(coupureParQuotaDuDernierTour(fil)).toBeUndefined()
  })
})

describe('lotsRetenusParLeQuota', () => {
  const coupe = [demande, { role: 'assistant', status: 'failed', error: REFUS }]

  it('retient seulement quand la TÊTE de file est un lot et que le dernier tour est coupé', () => {
    expect(lotsRetenusParLeQuota([{ lot: true }, {}], coupe)).toBe(true)
    // Un texte tapé en tête part : c'est une demande, pas une suite relâchée par l'app.
    expect(lotsRetenusParLeQuota([{}, { lot: true }], coupe)).toBe(false)
    expect(lotsRetenusParLeQuota([], coupe)).toBe(false)
    expect(
      lotsRetenusParLeQuota([{ lot: true }], [demande, { role: 'assistant', status: 'completed' }])
    ).toBe(false)
  })
})
