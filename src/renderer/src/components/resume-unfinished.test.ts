import { describe, expect, it } from 'vitest'
import { pickTurnToResume, rejeuDejaEnregistre, type UnfinishedTurn } from './resume-unfinished'

const turn = (id: string, updatedAt: number, events = 3): UnfinishedTurn => ({
  conversationId: id,
  turnId: `t-${id}`,
  events,
  updatedAt
})

describe('pickTurnToResume — reprise AUTOMATIQUE, sans popup', () => {
  it('reprend le tour le PLUS RÉCEMMENT actif', () => {
    expect(
      pickTurnToResume([turn('vieux', 10), turn('recent', 99), turn('moyen', 50)])
    ).toMatchObject({ conversationId: 'recent' })
  })

  it('rien à reprendre → null (démarrage normal inchangé)', () => {
    expect(pickTurnToResume([])).toBeNull()
    expect(pickTurnToResume(null)).toBeNull()
    expect(pickTurnToResume(undefined)).toBeNull()
  })

  it('ignore un tour SANS événement récupéré (rien à montrer)', () => {
    expect(pickTurnToResume([turn('vide', 99, 0)])).toBeNull()
    expect(pickTurnToResume([turn('vide', 99, 0), turn('utile', 10)])).toMatchObject({
      conversationId: 'utile'
    })
  })

  it('ignore une entrée malformée sans planter', () => {
    const malformed = [{ conversationId: '', turnId: 't', events: 5, updatedAt: 99 }, turn('ok', 1)]
    expect(pickTurnToResume(malformed)).toMatchObject({ conversationId: 'ok' })
  })

  /**
   * PEREMPTION — mesuree le 2026-08-18. `unfinishedTurns()` placait en tete DEUX tours de la veille
   * (conv-1267, 1 evenement chacun), vestiges d'un processus tue avant leur cloture. Comme la
   * reprise d'un tour inacheve est PRIORITAIRE sur la memoire de la derniere conversation ouverte,
   * l'utilisateur retombait a chaque demarrage sur cette conversation au lieu de son travail.
   */
  it('ne reprend PAS un tour plus vieux que la fenetre de peremption', () => {
    const maintenant = 1_000_000_000_000
    const veille = maintenant - 40 * 60 * 60 * 1000

    // Sans horloge : comportement historique, le plus recent gagne quel que soit son age.
    expect(pickTurnToResume([turn('vestige', veille)])).toMatchObject({
      conversationId: 'vestige'
    })
    // Avec horloge : le vestige est ecarte, et rien d'autre ne le remplace.
    expect(pickTurnToResume([turn('vestige', veille)], maintenant)).toBeNull()
  })

  it('prefere un tour FRAIS a un vestige plus recent que lui ne l est ancien', () => {
    const maintenant = 1_000_000_000_000
    const frais = turn('frais', maintenant - 2 * 60 * 60 * 1000)
    const vestige = turn('vestige', maintenant - 50 * 60 * 60 * 1000)
    expect(pickTurnToResume([vestige, frais], maintenant)).toMatchObject({
      conversationId: 'frais'
    })
  })

  it('laisse passer une nuit — le cas legitime le plus proche de la frontiere', () => {
    const maintenant = 1_000_000_000_000
    const hierSoir = turn('hier-soir', maintenant - 14 * 60 * 60 * 1000)
    expect(pickTurnToResume([hierSoir], maintenant)).toMatchObject({
      conversationId: 'hier-soir'
    })
  })
})

// conv-1149 (2026-10-25) : le rejeu d'un tour encore en vol ne remplace plus son enregistrement.
describe('rejeuDejaEnregistre', () => {
  const enVol = { role: 'assistant', turnId: 'T', status: 'streaming', parts: [] }

  it('tour enregistré encore en vol : rien à rejouer, même si son texte diffère', () => {
    expect(rejeuDejaEnregistre([{ role: 'user', content: 'q' }, enVol], 'T', 'texte')).toBe(true)
  })

  it('tour clos qui porte déjà le texte rejoué : rien à rejouer', () => {
    const clos = { role: 'assistant', turnId: 'T', status: 'interrupted', content: 'Bonjour à toi' }
    expect(rejeuDejaEnregistre([clos], 'T', '  Bonjour  ')).toBe(true)
  })

  it('texte absent de l’enregistrement, ou autre tour : le rejeu reste utile', () => {
    const clos = { role: 'assistant', turnId: 'T', status: 'interrupted', content: '' }
    expect(rejeuDejaEnregistre([clos], 'T', 'produit app fermée')).toBe(false)
    expect(rejeuDejaEnregistre([{ ...enVol, turnId: 'autre' }], 'T', 'x')).toBe(false)
  })
})
